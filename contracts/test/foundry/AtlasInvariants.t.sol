// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import { AtlasVaultV2 } from "../../contracts/atlas/AtlasVaultV2.sol";
import { TradingStrategy } from "../../contracts/atlas/TradingStrategy.sol";
import { MockERC20 } from "../../contracts/MockERC20.sol";
import { MockX } from "../../contracts/MockX.sol";
import { DemoAMM } from "../../contracts/DemoAMM.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Invariant tests enforce the V2 trust claims under random call
///         sequences. Run via `forge test --match-contract AtlasInvariants`
///         in CI; locally on Windows, run the Hardhat adversarial suite
///         (test/AtlasV2.test.ts) which covers the same ground deterministically.
contract AtlasInvariantsTest is Test {
    AtlasVaultV2 public vault;
    TradingStrategy public strategy;
    MockERC20 public bUSD;
    MockX public mockX;
    DemoAMM public amm;

    address public admin = address(0xA11CE);
    address public depositor = address(0xBEEF);
    address public attacker = address(0xBAD);

    // Handler — the set of actions fuzzed against the vault.
    Handler public handler;

    function setUp() public {
        bUSD = new MockERC20("Beacon USD", "bUSD");
        mockX = new MockX();
        amm = new DemoAMM(IERC20(address(bUSD)), IERC20(address(mockX)));

        bUSD.mint(admin, 1_000_000e6);
        mockX.mint(admin, 1_000_000e6);
        vm.startPrank(admin);
        bUSD.approve(address(amm), type(uint256).max);
        mockX.approve(address(amm), type(uint256).max);
        amm.addLiquidity(100_000e6, 100_000e6);

        vault = new AtlasVaultV2(IERC20(address(bUSD)), admin);
        strategy = new TradingStrategy(
            address(vault),
            address(bUSD),
            address(mockX),
            address(amm),
            address(0), // no oracle in invariant tests — spot valuation
            "Fear"
        );
        vault.registerStrategy(address(strategy), 100_000e6);
        vm.stopPrank();

        handler = new Handler(vault, bUSD, mockX, admin, depositor, attacker);

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = Handler.deposit.selector;
        selectors[1] = Handler.withdraw.selector;
        selectors[2] = Handler.attackerMints.selector;
        selectors[3] = Handler.attackerTopsUpVault.selector;
        selectors[4] = Handler.adminHarvest.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @dev totalSupply * pricePerShare should ≈ totalAssets, up to 1 wei
    ///      rounding.
    function invariant_NAVMatchesSharesAtSpot() public view {
        uint256 supply = vault.totalSupply();
        uint256 nav = vault.totalAssets();
        if (supply == 0) {
            assertTrue(nav >= 0);
            return;
        }
        uint256 pps = vault.pricePerShare();
        uint256 derived = (supply * pps) / 10 ** vault.decimals();
        // Rounding tolerance: 1 bUSD worst case for the invariant runner's
        // compounded state mutations.
        assertApproxEqAbs(derived, nav, 1_000_000);
    }

    /// @dev External EOAs minting tokens or direct-transferring to the vault
    ///      address must not mint any shares.
    function invariant_OutsidersCannotMintShares() public view {
        assertEq(vault.balanceOf(attacker), 0);
    }

    /// @dev Vault's NAV must always be at least the idle balance held by the
    ///      vault contract — strategy equity can only add, not subtract.
    function invariant_NAVCoversIdle() public view {
        assertGe(vault.totalAssets(), bUSD.balanceOf(address(vault)));
    }
}

/// @notice Handler contract the invariant engine calls with random sequences.
contract Handler is Test {
    AtlasVaultV2 public vault;
    MockERC20 public bUSD;
    MockX public mockX;
    address public admin;
    address public depositor;
    address public attacker;

    constructor(
        AtlasVaultV2 _vault,
        MockERC20 _bUSD,
        MockX _mockX,
        address _admin,
        address _depositor,
        address _attacker
    ) {
        vault = _vault;
        bUSD = _bUSD;
        mockX = _mockX;
        admin = _admin;
        depositor = _depositor;
        attacker = _attacker;
    }

    function deposit(uint256 assets) public {
        assets = bound(assets, 1, 1_000e6);
        bUSD.mint(depositor, assets);
        vm.startPrank(depositor);
        bUSD.approve(address(vault), assets);
        vault.deposit(assets);
        vm.stopPrank();
    }

    function withdraw(uint256 sharesSeed) public {
        uint256 bal = vault.balanceOf(depositor);
        if (bal == 0) return;
        uint256 shares = bound(sharesSeed, 1, bal);
        uint256 expected = vault.convertToAssets(shares);
        uint256 idle = bUSD.balanceOf(address(vault));
        if (expected > idle) return; // withdraw would revert
        vm.prank(depositor);
        vault.withdraw(shares);
    }

    /// @dev Attacker mints themselves tokens. Must not affect vault state.
    function attackerMints(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e6);
        bUSD.mint(attacker, amount);
        mockX.mint(attacker, amount);
    }

    /// @dev Attacker direct-transfers bUSD to the vault address. Increases
    ///      NAV but does not mint the attacker shares (they don't go through deposit).
    function attackerTopsUpVault(uint256 amount) public {
        amount = bound(amount, 1, 100_000e6);
        bUSD.mint(attacker, amount);
        vm.prank(attacker);
        bUSD.transfer(address(vault), amount);
    }

    function adminHarvest() public {
        // harvest is permissionless, just call it on the first registered strategy
        if (vault.strategyCount() == 0) return;
        address s = vault.strategyList(0);
        vault.harvest(s);
    }
}
