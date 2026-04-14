/**
 * Lightweight toast notifications. No deps. Stacks bottom-right.
 */

type ToastKind = "info" | "success" | "error" | "pending";

export interface ToastOpts {
  kind?: ToastKind;
  duration?: number;     // ms
  href?: string;         // make whole toast clickable
  action?: { label: string; href: string };
}

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container && document.body.contains(container)) return container;
  const el = document.createElement("div");
  el.className = "toast-container";
  document.body.appendChild(el);
  container = el;
  return el;
}

export function toast(message: string, opts: ToastOpts = {}): () => void {
  const root = ensureContainer();
  const kind = opts.kind ?? "info";
  const duration = opts.duration ?? (kind === "pending" ? 0 : 5000);

  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  const inner = document.createElement("div");
  inner.className = "toast-inner";
  inner.innerHTML = `
    <span class="toast-glyph"></span>
    <span class="toast-msg"></span>
    ${opts.action ? `<a class="toast-action" href="${opts.action.href}" target="_blank" rel="noopener">${opts.action.label}</a>` : ""}
    <button class="toast-close" aria-label="Dismiss">×</button>
  `;
  (inner.querySelector(".toast-msg") as HTMLElement).textContent = message;
  el.appendChild(inner);
  if (opts.href) {
    el.style.cursor = "pointer";
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".toast-close")) return;
      window.open(opts.href!, "_blank", "noopener");
    });
  }
  inner.querySelector(".toast-close")!.addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
  });

  root.appendChild(el);
  // animate in
  requestAnimationFrame(() => el.classList.add("in"));

  const dismiss = () => {
    el.classList.remove("in");
    el.classList.add("out");
    setTimeout(() => el.remove(), 240);
  };
  if (duration > 0) setTimeout(dismiss, duration);
  return dismiss;
}
