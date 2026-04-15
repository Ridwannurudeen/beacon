/**
 * Docs page — wallet chip + TOC active-section highlight.
 */
import * as wallet from "./wallet.js";
import { toast } from "./toast.js";

function renderChip() {
  wallet.renderWalletChip("wallet-slot", { onToast: (msg, kind) => toast(msg, { kind }) });
}

function initTOC() {
  const toc = document.querySelector(".docs-toc");
  if (!toc) return;
  const links = Array.from(toc.querySelectorAll("a")) as HTMLAnchorElement[];
  const sections = links.map((a) => document.querySelector<HTMLElement>(a.getAttribute("href") ?? "")).filter((x): x is HTMLElement => !!x);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const id = e.target.id;
      links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${id}`));
    }
  }, { rootMargin: "-20% 0px -70% 0px", threshold: 0 });
  sections.forEach((s) => io.observe(s));
}

wallet.init();
wallet.onChange(renderChip);
initTOC();
