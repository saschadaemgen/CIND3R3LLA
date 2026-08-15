/* @ds-bundle: {"format":4,"namespace":"CinderellaDesignSystem_593713","components":[{"name":"Badge","sourcePath":"components/display/Badge.jsx"},{"name":"Card","sourcePath":"components/display/Card.jsx"},{"name":"Icon","sourcePath":"components/display/Icon.jsx"},{"name":"Tag","sourcePath":"components/display/Tag.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"IconButton","sourcePath":"components/forms/IconButton.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"CookieBanner","sourcePath":"components/marketing/CookieBanner.jsx"},{"name":"FeatureTile","sourcePath":"components/marketing/FeatureTile.jsx"},{"name":"PricingTier","sourcePath":"components/marketing/PricingTier.jsx"},{"name":"SectionHeader","sourcePath":"components/marketing/SectionHeader.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/display/Badge.jsx":"3d40d60720ed","components/display/Card.jsx":"c4bdae89d614","components/display/Icon.jsx":"00d054642106","components/display/Tag.jsx":"002a1ab0e735","components/feedback/Dialog.jsx":"58715f34c4e6","components/feedback/Toast.jsx":"ecb5f16b875d","components/feedback/Tooltip.jsx":"8a4603f8f597","components/forms/Button.jsx":"a9160d6bb893","components/forms/Checkbox.jsx":"c50c56449ac3","components/forms/IconButton.jsx":"a6f6418025f9","components/forms/Input.jsx":"22fc63ef3ae5","components/forms/Radio.jsx":"7ed66a3c923b","components/forms/Select.jsx":"a9362b318a8a","components/forms/Switch.jsx":"5695d489f5bc","components/marketing/CookieBanner.jsx":"53704af444a3","components/marketing/FeatureTile.jsx":"1b9d2f00efcc","components/marketing/PricingTier.jsx":"eea125bdf020","components/marketing/SectionHeader.jsx":"75f3cf2c94fb","components/navigation/Tabs.jsx":"85b9f7694367","ui_kits/website/ArchiveDemo.jsx":"d81e13a2b631","ui_kits/website/Chrome.jsx":"c3f222bcaf4c","ui_kits/website/Effects.jsx":"d1001b26e2c5","ui_kits/website/Features.jsx":"f513df85461a","ui_kits/website/Home.jsx":"e551b93d9e89","ui_kits/website/Legal.jsx":"ec89d9bb6794","ui_kits/website/Login.jsx":"0191ada45d35","ui_kits/website/OpenSource.jsx":"70823525835c","ui_kits/website/Pro.jsx":"9315a754eb04","ui_kits/website/Security.jsx":"2a910f6ff205"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.CinderellaDesignSystem_593713 = window.CinderellaDesignSystem_593713 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/display/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-badge{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;border-radius:var(--radius-xs);font-family:var(--font-sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;border:1px solid transparent}
.cn-badge-neutral{background:var(--surface-hover);color:var(--text-muted)}
.cn-badge-accent{background:var(--info-surface);color:var(--text-accent);border-color:var(--border-hairline)}
.cn-badge-success{background:var(--success-surface);color:var(--success)}
.cn-badge-warning{background:var(--warning-surface);color:var(--warning)}
.cn-badge-danger{background:var(--danger-surface);color:var(--danger)}
.cn-badge-outline{background:transparent;color:var(--text-muted);border-color:var(--border-neutral)}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-badge-css", css);
function Badge({
  tone = "neutral",
  className = "",
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: `cn-badge cn-badge-${tone} ${className}`
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-card{border-radius:var(--radius-md);font-family:var(--font-sans)}
.cn-card-default{background:var(--card-sheen),var(--surface-card);border:1px solid var(--border-hairline);box-shadow:var(--edge-lit),var(--shadow-1)}
.cn-card-quiet{background:var(--surface-raised);border:1px solid var(--border-neutral)}
.cn-card-accent{background:var(--card-sheen),var(--surface-card);border:1px solid var(--border-strong);box-shadow:var(--edge-lit),var(--glow-accent),var(--shadow-1)}
[data-theme="light"] .cn-card-default,[data-theme="light"] .cn-card-accent{background:var(--surface-card)}
.cn-card-pad-md{padding:20px}
.cn-card-pad-lg{padding:28px}
.cn-card-hover{transition:border-color var(--duration-base) var(--ease),box-shadow var(--duration-base) var(--ease),transform var(--duration-base) var(--ease);cursor:pointer}
.cn-card-hover:hover{border-color:var(--border-strong);box-shadow:var(--edge-lit),var(--glow-accent),var(--shadow-2);transform:translateY(-2px)}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-card-css", css);
function Card({
  variant = "default",
  padding = "md",
  hover,
  className = "",
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `cn-card cn-card-${variant}${padding === "none" ? "" : ` cn-card-pad-${padding}`}${hover ? " cn-card-hover" : ""} ${className}`
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card.jsx", error: String((e && e.message) || e) }); }

// components/display/Icon.jsx
try { (() => {
const BASE = "https://cdn.jsdelivr.net/npm/lucide-static@0.462.0/icons/";
function Icon({
  name,
  size = 20,
  label,
  color,
  className = "",
  style
}) {
  const url = `url("${BASE}${name}.svg")`;
  return /*#__PURE__*/React.createElement("span", {
    role: label ? "img" : undefined,
    "aria-label": label,
    "aria-hidden": label ? undefined : "true",
    className: className,
    style: {
      display: "inline-block",
      flex: "none",
      width: size,
      height: size,
      background: color || "currentColor",
      WebkitMask: `${url} center/contain no-repeat`,
      mask: `${url} center/contain no-repeat`,
      verticalAlign: "-0.18em",
      ...style
    }
  });
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Icon.jsx", error: String((e && e.message) || e) }); }

// components/display/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-tag{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:var(--radius-sm);border:1px solid var(--border-neutral);background:transparent;font-family:var(--font-sans);font-size:13px;color:var(--text-body);transition:background var(--duration-fast) var(--ease),border-color var(--duration-fast) var(--ease),color var(--duration-fast) var(--ease)}
button.cn-tag{cursor:pointer}
button.cn-tag:hover{border-color:var(--border-strong);color:var(--text-bright)}
button.cn-tag:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.cn-tag-selected{background:var(--surface-accent-weak);border-color:var(--border-strong);color:var(--text-accent)}
button.cn-tag-selected:hover{border-color:var(--accent);color:var(--accent-hover)}
.cn-tag-x{display:inline-flex;border:none;background:none;padding:2px;margin-right:-4px;cursor:pointer;color:inherit;opacity:.6;border-radius:4px}
.cn-tag-x:hover{opacity:1}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-tag-css", css);
const X = () => /*#__PURE__*/React.createElement("svg", {
  width: "12",
  height: "12",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2.5",
  strokeLinecap: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M18 6 6 18M6 6l12 12"
}));
function Tag({
  selected,
  onRemove,
  onClick,
  className = "",
  children,
  ...rest
}) {
  const cls = `cn-tag${selected ? " cn-tag-selected" : ""} ${className}`;
  if (onClick) return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    onClick: onClick,
    "aria-pressed": selected,
    className: cls
  }, rest), children);
  return /*#__PURE__*/React.createElement("span", _extends({
    className: cls
  }, rest), children, onRemove && /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Remove",
    className: "cn-tag-x",
    onClick: onRemove
  }, /*#__PURE__*/React.createElement(X, null)));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Tag.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
const css = `
.cn-dialog-overlay{position:fixed;inset:0;background:var(--scrim);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px;z-index:100;animation:cn-fade var(--duration-base) var(--ease)}
.cn-dialog{background:var(--surface-card);border:1px solid var(--border-hairline);border-radius:var(--radius-lg);box-shadow:var(--edge-lit),var(--shadow-3);max-height:85vh;overflow:auto;font-family:var(--font-sans);animation:cn-rise var(--duration-base) var(--ease-out)}
.cn-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:22px 22px 0}
.cn-dialog-title{font-size:20px;font-weight:700;line-height:1.25;letter-spacing:-.01em;margin:0;color:var(--text-bright)}
.cn-dialog-body{padding:12px 22px 22px;font-size:14px;color:var(--text-muted);line-height:1.6}
.cn-dialog-foot{display:flex;justify-content:flex-end;gap:10px;padding:0 22px 22px}
.cn-dialog-x{flex:none;border:none;background:none;cursor:pointer;width:32px;height:32px;margin:-4px -8px 0 0;border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;color:var(--text-muted)}
.cn-dialog-x:hover{background:var(--surface-hover);color:var(--text-bright)}
@keyframes cn-fade{from{opacity:0}}
@keyframes cn-rise{from{opacity:0;transform:translateY(12px)}}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-dialog-css", css);
function Dialog({
  open,
  onClose,
  title,
  width = 440,
  footer,
  children
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = e => {
      if (e.key === "Escape" && onClose) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "cn-dialog-overlay",
    onMouseDown: e => {
      if (e.target === e.currentTarget && onClose) onClose();
    }
  }, /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": "true",
    "aria-label": typeof title === "string" ? title : undefined,
    className: "cn-dialog",
    style: {
      width,
      maxWidth: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "cn-dialog-head"
  }, title && /*#__PURE__*/React.createElement("h2", {
    className: "cn-dialog-title"
  }, title), onClose && /*#__PURE__*/React.createElement("button", {
    className: "cn-dialog-x",
    "aria-label": "Close",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "cn-dialog-body"
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    className: "cn-dialog-foot"
  }, footer)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-toast{display:flex;align-items:flex-start;gap:12px;width:max-content;max-width:420px;background:var(--surface-card);color:var(--text-body);border:1px solid var(--border-hairline);border-radius:var(--radius-md);box-shadow:var(--edge-lit),var(--shadow-2);padding:13px 15px;font-family:var(--font-sans);animation:cn-toast-in var(--duration-base) var(--ease-out)}
.cn-toast-icon{flex:none;margin-top:1px}
.cn-toast-title{font-size:14px;font-weight:700;color:var(--text-bright)}
.cn-toast-desc{font-size:13px;color:var(--text-muted);margin-top:2px}
.cn-toast-x{flex:none;border:none;background:none;cursor:pointer;color:var(--text-faint);padding:2px;margin:-2px -4px 0 4px;border-radius:4px}
.cn-toast-x:hover{color:var(--text-bright)}
@keyframes cn-toast-in{from{opacity:0;transform:translateY(10px)}}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-toast-css", css);
const glyphs = {
  success: /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--success)",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m9 12 2 2 4-4"
  })),
  danger: /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--danger)",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m15 9-6 6M9 9l6 6"
  })),
  info: /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--info)",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 16v-4M12 8h.01"
  }))
};
function Toast({
  intent = "info",
  title,
  description,
  onDismiss,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "status",
    className: `cn-toast ${className}`
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: "cn-toast-icon",
    "aria-hidden": "true"
  }, glyphs[intent] || glyphs.info), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    className: "cn-toast-title"
  }, title), description && /*#__PURE__*/React.createElement("div", {
    className: "cn-toast-desc"
  }, description)), onDismiss && /*#__PURE__*/React.createElement("button", {
    className: "cn-toast-x",
    "aria-label": "Dismiss",
    onClick: onDismiss
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  }))));
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
const css = `
.cn-tip-wrap{position:relative;display:inline-flex}
.cn-tip{position:absolute;left:50%;transform:translate(-50%,4px);background:var(--ink-700);border:1px solid var(--border-hairline);color:var(--text-bright);font-family:var(--font-sans);font-size:12px;line-height:1.4;padding:5px 9px;border-radius:var(--radius-sm);white-space:nowrap;pointer-events:none;opacity:0;box-shadow:var(--shadow-1);transition:opacity var(--duration-fast) var(--ease),transform var(--duration-fast) var(--ease);z-index:60}
[data-theme="light"] .cn-tip{background:#0F1B2D;border-color:transparent;color:#E8EDF4}
.cn-tip-top{bottom:calc(100% + 6px)}
.cn-tip-bottom{top:calc(100% + 6px);transform:translate(-50%,-4px)}
.cn-tip-wrap:hover .cn-tip,.cn-tip-wrap:focus-within .cn-tip{opacity:1;transform:translate(-50%,0)}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-tip-css", css);
function Tooltip({
  content,
  side = "top",
  className = "",
  children
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `cn-tip-wrap ${className}`
  }, children, /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    className: `cn-tip cn-tip-${side}`
  }, content));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;border-radius:var(--radius-sm);font-family:var(--font-sans);font-weight:600;cursor:pointer;transition:background var(--duration-fast) var(--ease),color var(--duration-fast) var(--ease),border-color var(--duration-fast) var(--ease),box-shadow var(--duration-base) var(--ease),transform var(--duration-fast) var(--ease);text-decoration:none;white-space:nowrap}
.cn-btn:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.cn-btn:active:not(:disabled){transform:translateY(1px)}
.cn-btn:disabled{opacity:.4;cursor:not-allowed}
.cn-btn-sm{height:32px;padding:0 14px;font-size:13px}
.cn-btn-md{height:40px;padding:0 18px;font-size:14px}
.cn-btn-lg{height:48px;padding:0 24px;font-size:15px}
.cn-btn-primary{background:linear-gradient(180deg,var(--cyan-400),var(--cyan-500));color:var(--text-on-accent);box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 1px 2px rgba(4,18,26,.5)}
.cn-btn-primary:hover:not(:disabled){background:linear-gradient(180deg,var(--cyan-300),var(--cyan-400));box-shadow:inset 0 1px 0 rgba(255,255,255,.36),var(--glow-accent)}
.cn-btn-primary:active:not(:disabled){background:var(--primary-active);box-shadow:inset 0 1px 2px rgba(4,18,26,.4)}
.cn-btn-secondary{background:transparent;color:var(--text-accent);border-color:var(--border-strong)}
.cn-btn-secondary:hover:not(:disabled){background:var(--surface-accent-weak);border-color:var(--accent)}
.cn-btn-ghost{background:transparent;color:var(--text-body)}
.cn-btn-ghost:hover:not(:disabled){background:var(--surface-hover);color:var(--text-bright)}
.cn-btn-full{width:100%}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-button-css", css);
function Button({
  variant = "primary",
  size = "md",
  fullWidth,
  className = "",
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    className: `cn-btn cn-btn-${variant} cn-btn-${size}${fullWidth ? " cn-btn-full" : ""} ${className}`
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-check{display:inline-flex;gap:10px;align-items:flex-start;cursor:pointer;font-family:var(--font-sans);position:relative}
.cn-check input{position:absolute;opacity:0;width:18px;height:18px;margin:0;cursor:pointer}
.cn-check-box{width:18px;height:18px;flex:none;margin-top:2px;border-radius:var(--radius-xs);border:1px solid var(--border-neutral);background:var(--surface-field);display:flex;align-items:center;justify-content:center;color:var(--text-on-accent);transition:background var(--duration-fast) var(--ease),border-color var(--duration-fast) var(--ease)}
.cn-check-box svg{opacity:0;transform:scale(.6);transition:opacity var(--duration-fast) var(--ease),transform var(--duration-fast) var(--ease)}
.cn-check:hover input:not(:disabled)~.cn-check-box{border-color:var(--border-strong)}
.cn-check input:checked~.cn-check-box{background:var(--accent);border-color:var(--accent)}
.cn-check input:checked~.cn-check-box svg{opacity:1;transform:scale(1)}
.cn-check input:focus-visible~.cn-check-box{box-shadow:var(--focus-ring)}
.cn-check input:disabled~*{opacity:.5;cursor:not-allowed}
.cn-check-label{font-size:14px;color:var(--text-body);line-height:1.5}
.cn-check-desc{font-size:12px;color:var(--text-faint);margin-top:1px}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-check-css", css);
function Checkbox({
  label,
  description,
  className = "",
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: `cn-check ${className}`,
    style: style
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox"
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "cn-check-box",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "3.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  }))), (label || description) && /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    className: "cn-check-label"
  }, label), description && /*#__PURE__*/React.createElement("div", {
    className: "cn-check-desc"
  }, description)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-iconbtn{display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--text-muted);cursor:pointer;transition:background var(--duration-fast) var(--ease),color var(--duration-fast) var(--ease),border-color var(--duration-fast) var(--ease),box-shadow var(--duration-fast) var(--ease)}
.cn-iconbtn:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.cn-iconbtn:active:not(:disabled){transform:translateY(1px)}
.cn-iconbtn:disabled{opacity:.4;cursor:not-allowed}
.cn-iconbtn-sm{width:32px;height:32px}
.cn-iconbtn-md{width:40px;height:40px}
.cn-iconbtn-lg{width:48px;height:48px}
.cn-iconbtn-ghost:hover:not(:disabled){background:var(--surface-hover);color:var(--text-bright)}
.cn-iconbtn-outline{border-color:var(--border-neutral);background:transparent}
.cn-iconbtn-outline:hover:not(:disabled){border-color:var(--border-strong);color:var(--text-accent);background:var(--surface-accent-weak)}
.cn-iconbtn-solid{background:var(--primary);color:var(--text-on-accent)}
.cn-iconbtn-solid:hover:not(:disabled){background:var(--primary-hover);box-shadow:var(--glow-accent)}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-iconbtn-css", css);
function IconButton({
  label,
  variant = "ghost",
  size = "md",
  className = "",
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    "aria-label": label,
    title: label,
    className: `cn-iconbtn cn-iconbtn-${variant} cn-iconbtn-${size} ${className}`
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-field{display:flex;flex-direction:column;gap:6px;font-family:var(--font-sans)}
.cn-field-label{font-size:13px;font-weight:600;color:var(--text-bright)}
.cn-field-hint{font-size:12px;color:var(--text-faint)}
.cn-field-error{font-size:12px;color:var(--danger);font-weight:600}
.cn-input{font-family:var(--font-sans);font-size:14px;color:var(--text-bright);background:var(--surface-field);border:1px solid var(--border-neutral);border-radius:var(--radius-sm);transition:border-color var(--duration-fast) var(--ease),box-shadow var(--duration-fast) var(--ease)}
.cn-input::placeholder{color:var(--text-faint)}
.cn-input:hover:not(:disabled){border-color:var(--border-strong)}
.cn-input:focus{outline:none;border-color:var(--accent);box-shadow:var(--focus-ring)}
.cn-input:disabled{opacity:.5;cursor:not-allowed}
.cn-input-md{height:40px;padding:0 12px}
.cn-input-lg{height:48px;padding:0 14px;font-size:15px}
.cn-input-invalid{border-color:var(--danger)}
.cn-input-invalid:focus{border-color:var(--danger);box-shadow:0 0 0 3px rgba(229,100,110,.25)}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-input-css", css);
let uid = 0;
function Input({
  label,
  hint,
  error,
  size = "md",
  id,
  className = "",
  style,
  ...rest
}) {
  const [autoId] = React.useState(() => `cn-in-${++uid}`);
  const inputId = id || autoId;
  return /*#__PURE__*/React.createElement("div", {
    className: "cn-field",
    style: style
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "cn-field-label",
    htmlFor: inputId
  }, label), /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    className: `cn-input cn-input-${size}${error ? " cn-input-invalid" : ""} ${className}`,
    "aria-invalid": !!error
  }, rest)), error ? /*#__PURE__*/React.createElement("div", {
    className: "cn-field-error"
  }, error) : hint ? /*#__PURE__*/React.createElement("div", {
    className: "cn-field-hint"
  }, hint) : null);
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-radio{display:inline-flex;gap:10px;align-items:flex-start;cursor:pointer;font-family:var(--font-sans);position:relative}
.cn-radio input{position:absolute;opacity:0;width:18px;height:18px;margin:0;cursor:pointer}
.cn-radio-dot{width:18px;height:18px;flex:none;margin-top:2px;border-radius:99px;border:1px solid var(--border-neutral);background:var(--surface-field);display:flex;align-items:center;justify-content:center;transition:border-color var(--duration-fast) var(--ease)}
.cn-radio-dot::after{content:"";width:8px;height:8px;border-radius:99px;background:var(--accent);transform:scale(0);transition:transform var(--duration-fast) var(--ease)}
.cn-radio:hover input:not(:disabled)~.cn-radio-dot{border-color:var(--border-strong)}
.cn-radio input:checked~.cn-radio-dot{border-color:var(--accent)}
.cn-radio input:checked~.cn-radio-dot::after{transform:scale(1)}
.cn-radio input:focus-visible~.cn-radio-dot{box-shadow:var(--focus-ring)}
.cn-radio input:disabled~*{opacity:.5;cursor:not-allowed}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-radio-css", css);
function Radio({
  label,
  description,
  className = "",
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: `cn-radio ${className}`,
    style: style
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "radio"
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "cn-radio-dot",
    "aria-hidden": "true"
  }), (label || description) && /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    className: "cn-check-label"
  }, label), description && /*#__PURE__*/React.createElement("div", {
    className: "cn-check-desc"
  }, description)));
}
Object.assign(__ds_scope, { Radio });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const chevron = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;
const css = `
.cn-select{appearance:none;-webkit-appearance:none;font-family:var(--font-sans);font-size:14px;color:var(--text-bright);background:var(--surface-field) ${chevron} no-repeat right 10px center/18px;border:1px solid var(--border-neutral);border-radius:var(--radius-sm);cursor:pointer;transition:border-color var(--duration-fast) var(--ease),box-shadow var(--duration-fast) var(--ease)}
.cn-select option{background:var(--surface-raised);color:var(--text-bright)}
.cn-select:hover:not(:disabled){border-color:var(--border-strong)}
.cn-select:focus{outline:none;border-color:var(--accent);box-shadow:var(--focus-ring)}
.cn-select:disabled{opacity:.5;cursor:not-allowed}
.cn-select-md{height:40px;padding:0 34px 0 12px}
.cn-select-lg{height:48px;padding:0 36px 0 14px;font-size:15px}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-select-css", css);
let uid = 0;
function Select({
  label,
  hint,
  error,
  size = "md",
  id,
  className = "",
  style,
  children,
  ...rest
}) {
  const [autoId] = React.useState(() => `cn-sel-${++uid}`);
  const selectId = id || autoId;
  return /*#__PURE__*/React.createElement("div", {
    className: "cn-field",
    style: style
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "cn-field-label",
    htmlFor: selectId
  }, label), /*#__PURE__*/React.createElement("select", _extends({
    id: selectId,
    className: `cn-select cn-select-${size} ${className}`,
    "aria-invalid": !!error
  }, rest), children), error ? /*#__PURE__*/React.createElement("div", {
    className: "cn-field-error"
  }, error) : hint ? /*#__PURE__*/React.createElement("div", {
    className: "cn-field-hint"
  }, hint) : null);
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-switch{display:inline-flex;align-items:center;gap:10px;cursor:pointer;border:none;background:none;padding:0;font-family:var(--font-sans)}
.cn-switch-track{width:36px;height:20px;flex:none;border-radius:99px;background:var(--ink-600);border:1px solid var(--border-neutral);position:relative;transition:background var(--duration-base) var(--ease),border-color var(--duration-base) var(--ease)}
[data-theme="light"] .cn-switch-track{background:#CBD5E1}
.cn-switch-track::after{content:"";position:absolute;top:1px;left:1px;width:16px;height:16px;border-radius:99px;background:var(--slate-200);transition:transform var(--duration-base) var(--ease),background var(--duration-base) var(--ease)}
.cn-switch[aria-checked="true"] .cn-switch-track{background:var(--accent);border-color:var(--accent)}
.cn-switch[aria-checked="true"] .cn-switch-track::after{transform:translateX(16px);background:#04121A}
.cn-switch:hover:not(:disabled) .cn-switch-track{border-color:var(--border-strong)}
.cn-switch:focus-visible{outline:none}
.cn-switch:focus-visible .cn-switch-track{box-shadow:var(--focus-ring)}
.cn-switch:disabled{opacity:.5;cursor:not-allowed}
.cn-switch-label{font-size:14px;color:var(--text-body)}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-switch-css", css);
function Switch({
  checked,
  onChange,
  label,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "switch",
    "aria-checked": !!checked,
    onClick: () => onChange && onChange(!checked),
    className: `cn-switch ${className}`
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: "cn-switch-track",
    "aria-hidden": "true"
  }), label && /*#__PURE__*/React.createElement("span", {
    className: "cn-switch-label"
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/marketing/CookieBanner.jsx
try { (() => {
const css = `
.cn-cookiebar{position:fixed;left:0;right:0;bottom:0;z-index:90;background:var(--surface-raised);border-top:1px solid var(--border-hairline);box-shadow:var(--edge-lit),0 -8px 32px rgba(0,0,0,.4);font-family:var(--font-sans);animation:cn-cookie-in var(--duration-slow) var(--ease-out)}
[data-theme="light"] .cn-cookiebar{box-shadow:0 -8px 32px rgba(15,27,45,.12)}
.cn-cookiebar-inner{max-width:1200px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.cn-cookiebar-text{flex:1;min-width:260px;font-size:13px;line-height:1.55;color:var(--text-muted)}
.cn-cookiebar-text b{color:var(--text-bright);font-weight:700}
.cn-cookiebar-actions{display:flex;gap:10px}
@keyframes cn-cookie-in{from{transform:translateY(100%)}}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-cookiebar-css", css);
function CookieBanner({
  title = "Cookies",
  text,
  acceptLabel = "Accept",
  declineLabel = "Decline necessary only",
  onAccept,
  onDecline,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "region",
    "aria-label": "Cookie consent",
    className: "cn-cookiebar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cn-cookiebar-inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cn-cookiebar-text"
  }, /*#__PURE__*/React.createElement("b", null, title), " \u2014 ", text || children), /*#__PURE__*/React.createElement("div", {
    className: "cn-cookiebar-actions"
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    size: "sm",
    onClick: onDecline
  }, declineLabel), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    size: "sm",
    onClick: onAccept
  }, acceptLabel))));
}
Object.assign(__ds_scope, { CookieBanner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/CookieBanner.jsx", error: String((e && e.message) || e) }); }

// components/marketing/FeatureTile.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-ftile-icon{width:40px;height:40px;border-radius:var(--radius-sm);background:var(--surface-accent-weak);border:1px solid var(--border-hairline);display:flex;align-items:center;justify-content:center;color:var(--text-accent);box-shadow:var(--edge-lit)}
.cn-ftile-title{font-size:16px;font-weight:700;color:var(--text-bright);margin:14px 0 0;display:flex;align-items:center;gap:8px}
.cn-ftile-body{font-size:14px;line-height:1.6;color:var(--text-muted);margin:6px 0 0}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-ftile-css", css);
function FeatureTile({
  icon,
  title,
  children,
  badge,
  hover,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement(__ds_scope.Card, _extends({
    hover: hover,
    className: className
  }, rest), icon && /*#__PURE__*/React.createElement("div", {
    className: "cn-ftile-icon"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon
  })), /*#__PURE__*/React.createElement("div", {
    className: "cn-ftile-title"
  }, title, badge), /*#__PURE__*/React.createElement("p", {
    className: "cn-ftile-body"
  }, children));
}
Object.assign(__ds_scope, { FeatureTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/FeatureTile.jsx", error: String((e && e.message) || e) }); }

// components/marketing/PricingTier.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-tier-name{font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);display:flex;align-items:center;gap:8px}
.cn-tier-highlight .cn-tier-name{color:var(--text-accent)}
.cn-tier-price{margin:14px 0 2px;color:var(--text-bright)}
.cn-tier-price b{font-size:36px;font-weight:700;letter-spacing:-.02em}
.cn-tier-price span{font-size:14px;color:var(--text-faint);font-weight:400}
.cn-tier-desc{font-size:14px;color:var(--text-muted);line-height:1.55;margin:6px 0 0;min-height:44px}
.cn-tier-list{list-style:none;margin:18px 0 22px;padding:0;display:flex;flex-direction:column;gap:9px}
.cn-tier-list li{display:flex;gap:9px;align-items:flex-start;font-size:14px;color:var(--text-body)}
.cn-tier-list li::before{content:"";flex:none;width:16px;height:16px;margin-top:2px;background:var(--text-accent);-webkit-mask:url("https://cdn.jsdelivr.net/npm/lucide-static@0.462.0/icons/check.svg") center/contain no-repeat;mask:url("https://cdn.jsdelivr.net/npm/lucide-static@0.462.0/icons/check.svg") center/contain no-repeat}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-tier-css", css);
function PricingTier({
  name,
  price,
  period,
  description,
  features = [],
  cta = "Get started",
  onCta,
  highlight,
  badge,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement(__ds_scope.Card, _extends({
    variant: highlight ? "accent" : "default",
    padding: "lg",
    className: `${highlight ? "cn-tier-highlight" : ""} ${className}`
  }, rest), /*#__PURE__*/React.createElement("div", {
    className: "cn-tier-name"
  }, name, badge), /*#__PURE__*/React.createElement("div", {
    className: "cn-tier-price"
  }, /*#__PURE__*/React.createElement("b", null, price), period && /*#__PURE__*/React.createElement("span", null, " ", period)), description && /*#__PURE__*/React.createElement("p", {
    className: "cn-tier-desc"
  }, description), /*#__PURE__*/React.createElement("ul", {
    className: "cn-tier-list"
  }, features.map((f, i) => /*#__PURE__*/React.createElement("li", {
    key: i
  }, f))), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: highlight ? "primary" : "secondary",
    fullWidth: true,
    onClick: onCta
  }, cta));
}
Object.assign(__ds_scope, { PricingTier });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/PricingTier.jsx", error: String((e && e.message) || e) }); }

// components/marketing/SectionHeader.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-sechead{font-family:var(--font-sans);max-width:640px}
.cn-sechead-center{margin-left:auto;margin-right:auto;text-align:center}
.cn-sechead-eyebrow{font-size:12px;font-weight:700;letter-spacing:var(--tracking-caps);text-transform:uppercase;color:var(--text-accent);margin-bottom:10px}
.cn-sechead-title{font-size:var(--size-title);font-weight:700;letter-spacing:-.015em;line-height:1.2;color:var(--text-bright);margin:0}
.cn-sechead-lede{font-size:16px;line-height:1.6;color:var(--text-muted);margin:12px 0 0}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-sechead-css", css);
function SectionHeader({
  eyebrow,
  title,
  lede,
  align = "left",
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `cn-sechead${align === "center" ? " cn-sechead-center" : ""} ${className}`
  }, rest), eyebrow && /*#__PURE__*/React.createElement("div", {
    className: "cn-sechead-eyebrow"
  }, eyebrow), /*#__PURE__*/React.createElement("h2", {
    className: "cn-sechead-title"
  }, title), lede && /*#__PURE__*/React.createElement("p", {
    className: "cn-sechead-lede"
  }, lede));
}
Object.assign(__ds_scope, { SectionHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/SectionHeader.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.cn-tabs{display:flex;font-family:var(--font-sans)}
.cn-tabs-underline{gap:22px;border-bottom:1px solid var(--border-neutral)}
.cn-tabs-underline .cn-tab{border:none;background:none;cursor:pointer;padding:10px 2px;font-size:14px;font-weight:600;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-1px;transition:color var(--duration-fast) var(--ease),border-color var(--duration-fast) var(--ease)}
.cn-tabs-underline .cn-tab:hover{color:var(--text-bright)}
.cn-tabs-underline .cn-tab[aria-selected="true"]{color:var(--text-accent);border-bottom-color:var(--accent)}
.cn-tabs-segment{gap:4px;background:var(--surface-field);border:1px solid var(--border-neutral);border-radius:var(--radius-sm);padding:3px;width:max-content}
.cn-tabs-segment .cn-tab{border:none;background:none;cursor:pointer;height:30px;padding:0 14px;border-radius:6px;font-size:13px;font-weight:600;color:var(--text-muted);transition:background var(--duration-fast) var(--ease),color var(--duration-fast) var(--ease)}
.cn-tabs-segment .cn-tab:hover{color:var(--text-bright)}
.cn-tabs-segment .cn-tab[aria-selected="true"]{background:var(--surface-accent-weak);color:var(--text-accent);box-shadow:inset 0 0 0 1px var(--border-hairline)}
.cn-tab:focus-visible{outline:none;box-shadow:var(--focus-ring)}`;
const inject = (id, t) => {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = t;
    document.head.appendChild(s);
  }
};
inject("cn-tabs-css", css);
function Tabs({
  items,
  value,
  onChange,
  variant = "underline",
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tablist",
    className: `cn-tabs cn-tabs-${variant} ${className}`
  }, rest), items.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.id,
    role: "tab",
    type: "button",
    "aria-selected": it.id === value,
    className: "cn-tab",
    onClick: () => onChange && onChange(it.id)
  }, it.label)));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/ArchiveDemo.jsx
try { (() => {
const {
  Icon,
  Tag,
  Badge
} = window.CinderellaDesignSystem_593713;
const AD_MSGS = [{
  g: "#privacy-talk",
  a: "mara",
  t: "14:02",
  text: "New onion-routing writeup is up — covers guard selection end to end."
}, {
  g: "#privacy-talk",
  a: "devnull",
  t: "14:03",
  text: "Does it touch on padding overhead? That's where most guides hand-wave."
}, {
  g: "#selfhosting",
  a: "kai",
  t: "09:11",
  text: "Here's my docker-compose.yml for the archive bot behind Caddy.",
  media: "file"
}, {
  g: "#selfhosting",
  a: "lena",
  t: "09:14",
  text: "meetup_recording.mp4",
  media: "video"
}, {
  g: "#foss-de",
  a: "tomasz",
  t: "21:40",
  text: "AGPL vs GPL for a bot serving a public archive — 14 replies deep now."
}, {
  g: "#privacy-talk",
  a: "mara",
  t: "14:20",
  text: "Passkey rollout checklist v2 attached — WebAuthn only, no fallback.",
  media: "file"
}, {
  g: "#foss-de",
  a: "ingrid",
  t: "21:52",
  text: "Onion services plus this archive = searchable history without a central host."
}, {
  g: "#selfhosting",
  a: "kai",
  t: "10:02",
  text: "grafana-dashboard.png — capture throughput over 24h.",
  media: "image"
}, {
  g: "#privacy-talk",
  a: "devnull",
  t: "15:31",
  text: "Consent prompt fired before capture, logged with the group id. Clean."
}, {
  g: "#foss-de",
  a: "tomasz",
  t: "22:05",
  text: "Full-text search across a year of threads in under 40 ms."
}];
const AD_GROUPS = ["#privacy-talk", "#selfhosting", "#foss-de"];
const AD_MEDIA_ICON = {
  file: "file-text",
  video: "clapperboard",
  image: "image"
};
function adHighlight(text, q) {
  if (!q) return text;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp("(" + esc + ")", "ig"));
  return parts.map((p, i) => p.toLowerCase() === q.toLowerCase() ? /*#__PURE__*/React.createElement("mark", {
    key: i,
    className: "ad-hl"
  }, p) : p);
}
function ArchiveDemo() {
  const x = useX();
  const [q, setQ] = React.useState("");
  const [group, setGroup] = React.useState("all");
  const [mediaOnly, setMediaOnly] = React.useState(false);
  const interacted = React.useRef(false);
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timers = [],
      cancelled = false;
    const word = "onion";
    const type = i => {
      if (cancelled || interacted.current) return;
      setQ(word.slice(0, i));
      if (i < word.length) timers.push(setTimeout(() => type(i + 1), 150));else timers.push(setTimeout(() => del(word.length), 1600));
    };
    const del = i => {
      if (cancelled || interacted.current) return;
      setQ(word.slice(0, i));
      if (i > 0) timers.push(setTimeout(() => del(i - 1), 80));
    };
    timers.push(setTimeout(() => type(1), 900));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);
  const stop = () => {
    interacted.current = true;
  };
  const rows = AD_MSGS.filter(m => (group === "all" || m.g === group) && (!mediaOnly || m.media) && (!q || (m.text + " " + m.a + " " + m.g).toLowerCase().includes(q.toLowerCase())));
  return /*#__PURE__*/React.createElement("div", {
    className: "ad-frame"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ad-titlebar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ad-dot",
    style: {
      background: "#E5646E"
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "ad-dot",
    style: {
      background: "#E0B454"
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "ad-dot",
    style: {
      background: "#4ADE9E"
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "ad-url"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "lock",
    size: 12,
    color: "var(--success)"
  }), " archive.cinderella.example / ", group === "all" ? x("all groups", "alle Gruppen") : group), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      letterSpacing: ".08em",
      color: "var(--text-faint)",
      border: "1px solid var(--border-neutral)",
      borderRadius: 99,
      padding: "2px 9px"
    }
  }, x("PREVIEW · SAMPLE DATA", "VORSCHAU · BEISPIELDATEN"))), /*#__PURE__*/React.createElement("div", {
    className: "ad-body"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "ad-side"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ad-side-label"
  }, x("GROUPS", "GRUPPEN")), /*#__PURE__*/React.createElement("button", {
    className: `ad-g${group === "all" ? " on" : ""}`,
    onClick: () => {
      stop();
      setGroup("all");
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "archive",
    size: 14
  }), " ", x("All groups", "Alle Gruppen"), /*#__PURE__*/React.createElement("span", {
    className: "ad-count"
  }, AD_MSGS.length)), AD_GROUPS.map(g => /*#__PURE__*/React.createElement("button", {
    key: g,
    className: `ad-g${group === g ? " on" : ""}`,
    onClick: () => {
      stop();
      setGroup(g);
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "hash",
    size: 14
  }), g.replace("#", ""), /*#__PURE__*/React.createElement("span", {
    className: "ad-count"
  }, AD_MSGS.filter(m => m.g === g).length))), /*#__PURE__*/React.createElement("div", {
    className: "ad-consent"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "shield-check",
    size: 14,
    color: "var(--success)"
  }), /*#__PURE__*/React.createElement("span", null, x("Every group opted in. Withdraw anytime.", "Jede Gruppe hat zugestimmt. Jederzeit widerrufbar.")))), /*#__PURE__*/React.createElement("div", {
    className: "ad-main"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ad-searchbar"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 17,
    color: "var(--text-faint)"
  }), /*#__PURE__*/React.createElement("input", {
    ref: inputRef,
    className: "ad-input",
    value: q,
    placeholder: x("Search the archive…", "Archiv durchsuchen…"),
    onChange: e => {
      stop();
      setQ(e.target.value);
    },
    onFocus: stop,
    "aria-label": x("Search the archive", "Archiv durchsuchen")
  }), q && /*#__PURE__*/React.createElement("button", {
    className: "ad-clear",
    "aria-label": "Clear",
    onClick: () => {
      stop();
      setQ("");
      inputRef.current && inputRef.current.focus();
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 15
  }))), /*#__PURE__*/React.createElement("div", {
    className: "ad-filters"
  }, /*#__PURE__*/React.createElement(Tag, {
    onClick: () => {
      stop();
      setMediaOnly(!mediaOnly);
    },
    selected: mediaOnly
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "paperclip",
    size: 13
  }), " ", x("Has media", "Mit Medien")), /*#__PURE__*/React.createElement("span", {
    className: "ad-resultcount"
  }, rows.length === AD_MSGS.length ? x(`${AD_MSGS.length} messages`, `${AD_MSGS.length} Nachrichten`) : x(`${rows.length} of ${AD_MSGS.length}`, `${rows.length} von ${AD_MSGS.length}`), q && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-accent)"
    }
  }, " \xB7 \u201C", q, "\u201D"))), /*#__PURE__*/React.createElement("div", {
    className: "ad-scroll ad-stream"
  }, rows.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "ad-empty"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search-x",
    size: 22,
    color: "var(--text-faint)"
  }), /*#__PURE__*/React.createElement("div", null, x("No archived messages match", "Keine archivierten Nachrichten passen"), " \u201C", q, "\u201D.")) : rows.map((m, i) => /*#__PURE__*/React.createElement("div", {
    className: "ad-msg",
    key: m.g + m.t + i
  }, /*#__PURE__*/React.createElement("span", {
    className: "ad-avatar",
    "aria-hidden": "true"
  }, m.a[0].toUpperCase()), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ad-meta"
  }, /*#__PURE__*/React.createElement("b", null, adHighlight(m.a, q)), /*#__PURE__*/React.createElement("span", {
    className: "ad-grp"
  }, adHighlight(m.g, q)), /*#__PURE__*/React.createElement("span", {
    className: "ad-time"
  }, m.t), /*#__PURE__*/React.createElement("span", {
    className: "ad-arch"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 12,
    color: "var(--success)"
  }), x("archived", "archiviert"))), /*#__PURE__*/React.createElement("div", {
    className: "ad-text"
  }, adHighlight(m.text, q)), m.media && /*#__PURE__*/React.createElement("div", {
    className: "ad-chip"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: AD_MEDIA_ICON[m.media],
    size: 13,
    color: "var(--text-accent)"
  }), /*#__PURE__*/React.createElement("span", null, m.media === "file" ? x("attachment", "Anhang") : m.media === "video" ? "video · behind auth" : "image · behind auth"), /*#__PURE__*/React.createElement(Icon, {
    name: "lock",
    size: 11,
    color: "var(--text-faint)"
  })))))))));
}
Object.assign(window, {
  ArchiveDemo
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/ArchiveDemo.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Chrome.jsx
try { (() => {
const {
  Icon,
  Badge
} = window.CinderellaDesignSystem_593713;
const LangCtx = React.createContext("en");
const useX = () => {
  const lang = React.useContext(LangCtx);
  return (en, de) => lang === "de" ? de : en;
};
function Wordmark({
  size = 20,
  onClick
}) {
  return /*#__PURE__*/React.createElement("a", {
    href: "#/",
    onClick: onClick,
    style: {
      display: "inline-flex",
      alignItems: "center",
      textDecoration: "none"
    }
  }, /*#__PURE__*/React.createElement("img", {
    className: "wm-av",
    src: window.__resources && window.__resources.avatar || "../../assets/cinderella_avatar.jpeg",
    alt: "",
    "aria-hidden": "true",
    style: {
      width: size + 12,
      height: size + 12
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      fontSize: size,
      letterSpacing: "-.03em",
      color: "var(--text-bright)"
    }
  }, "Cinderella"));
}
function Header({
  route,
  nav,
  lang,
  setLang,
  theme,
  setTheme
}) {
  const x = useX();
  const [menu, setMenu] = React.useState(false);
  const links = [["home", x("Home", "Start")], ["features", x("Features", "Funktionen")], ["pro", "Pro"], ["security", x("Security", "Sicherheit")], ["open-source", "Open Source"]];
  const go = r => {
    setMenu(false);
    nav(r);
  };
  const controls = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "lang-seg",
    role: "group",
    "aria-label": "Language"
  }, /*#__PURE__*/React.createElement("button", {
    className: lang === "en" ? "on" : "",
    onClick: () => setLang("en")
  }, "EN"), /*#__PURE__*/React.createElement("button", {
    className: lang === "de" ? "on" : "",
    onClick: () => setLang("de")
  }, "DE")), /*#__PURE__*/React.createElement(IconBtn, {
    label: x("Switch theme", "Design wechseln"),
    onClick: () => setTheme(theme === "dark" ? "light" : "dark")
  }, /*#__PURE__*/React.createElement(Icon, {
    name: theme === "dark" ? "sun" : "moon",
    size: 18
  })), /*#__PURE__*/React.createElement("a", {
    className: "nav-login",
    href: "#/login",
    onClick: () => setMenu(false)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "key-round",
    size: 14
  }), " ", x("Login", "Anmelden")));
  return /*#__PURE__*/React.createElement("header", {
    className: "site-header"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wrap",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 20,
      height: 64
    }
  }, /*#__PURE__*/React.createElement(Wordmark, null), /*#__PURE__*/React.createElement("nav", {
    className: "nav-desktop",
    style: {
      gap: 2,
      flex: 1,
      marginLeft: 14
    }
  }, links.map(([r, l]) => /*#__PURE__*/React.createElement("a", {
    key: r,
    className: `nav-link${route === r ? " active" : ""}`,
    href: "#/" + (r === "home" ? "" : r)
  }, l)), /*#__PURE__*/React.createElement("a", {
    className: "nav-link",
    href: "#",
    onClick: e => e.preventDefault()
  }, x("Docs", "Doku"), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "external-link",
    size: 12
  })), /*#__PURE__*/React.createElement("a", {
    className: `nav-link${route === "legal" ? " active" : ""}`,
    href: "#/legal"
  }, x("Legal", "Rechtliches"))), /*#__PURE__*/React.createElement("span", {
    className: "nav-desktop",
    style: {
      gap: 10
    }
  }, controls), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    },
    className: "mobile-menu"
  }), /*#__PURE__*/React.createElement(IconBtn, {
    className: "burger",
    label: x("Menu", "Menü"),
    onClick: () => setMenu(!menu)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: menu ? "x" : "menu"
  }))), menu && /*#__PURE__*/React.createElement("div", {
    className: "mobile-menu",
    style: {
      borderTop: "1px solid var(--border-neutral)",
      background: "var(--surface-raised)",
      padding: "12px 24px 18px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, links.map(([r, l]) => /*#__PURE__*/React.createElement("a", {
    key: r,
    className: `nav-link${route === r ? " active" : ""}`,
    href: "#/" + (r === "home" ? "" : r),
    onClick: () => setMenu(false)
  }, l)), /*#__PURE__*/React.createElement("a", {
    className: "nav-link",
    href: "#",
    onClick: e => e.preventDefault()
  }, x("Docs", "Doku"), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "external-link",
    size: 12
  })), /*#__PURE__*/React.createElement("a", {
    className: "nav-link",
    href: "#/legal",
    onClick: () => setMenu(false)
  }, x("Legal", "Rechtliches"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      alignItems: "center",
      marginTop: 14
    }
  }, controls)));
}

// Small local icon button so the header chrome stays self-contained
function IconBtn({
  label,
  onClick,
  className = "",
  children
}) {
  return /*#__PURE__*/React.createElement("button", {
    "aria-label": label,
    title: label,
    onClick: onClick,
    className: "hdr-iconbtn " + className
  }, children);
}
function Footer({
  nav
}) {
  const x = useX();
  const col = (title, items) => /*#__PURE__*/React.createElement("div", {
    className: "fcol",
    style: {
      minWidth: 150
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: "var(--tracking-caps)",
      textTransform: "uppercase",
      color: "var(--text-neon)",
      marginBottom: 14
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, items.map(([label, href]) => /*#__PURE__*/React.createElement("a", {
    key: label,
    href: href
  }, label))));
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      marginTop: 120,
      borderTop: "1px solid var(--border-neutral)",
      background: "var(--surface-raised)",
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "foot-top",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("div", {
    className: "wrap",
    style: {
      display: "flex",
      gap: 48,
      padding: "64px 24px 44px",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "1 1 280px"
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    size: 22
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: "var(--text-muted)",
      margin: "14px 0 16px",
      maxWidth: 320,
      lineHeight: 1.65
    }
  }, x("The AI bot suite for SimpleX communities. Consent-first, permanent, searchable. Open source under AGPL-3.0.", "Die KI-Bot-Suite für SimpleX-Communities. Zustimmung zuerst, dauerhaft, durchsuchbar. Open Source unter AGPL-3.0.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "warning"
  }, "Alpha"), /*#__PURE__*/React.createElement(Badge, null, "AGPL-3.0"))), col(x("Product", "Produkt"), [[x("Features", "Funktionen"), "#/features"], ["Pro", "#/pro"], [x("Security", "Sicherheit"), "#/security"], [x("Docs", "Doku"), "#"]]), col("Open Source", [["GitHub", "#"], ["AGPL-3.0", "#/open-source"], [x("Changelog", "Changelog"), "#"]]), col(x("Legal", "Rechtliches"), [[x("Legal notice", "Impressum"), "#/legal/impressum"], [x("Privacy policy", "Datenschutzerklärung"), "#/legal/privacy"], [x("Terms", "Nutzungsbedingungen"), "#/legal/terms"]])), /*#__PURE__*/React.createElement("div", {
    className: "wrap",
    style: {
      display: "flex",
      justifyContent: "space-between",
      gap: 16,
      flexWrap: "wrap",
      padding: "18px 24px",
      borderTop: "1px solid var(--border-neutral)",
      fontSize: 13,
      color: "var(--text-faint)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 Sascha D\xE4mgen IT and More Systems"), /*#__PURE__*/React.createElement("span", null, x("Built on SimpleX. Not affiliated with SimpleX Chat.", "Basiert auf SimpleX. Nicht mit SimpleX Chat verbunden."))));
}
function PageHero({
  eyebrow,
  title,
  lede,
  badge,
  children
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "hero-bg fx-hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wrap",
    style: {
      padding: "80px 24px 64px",
      maxWidth: 900,
      position: "relative"
    }
  }, badge && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, badge), eyebrow && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: "var(--tracking-caps)",
      textTransform: "uppercase",
      color: "var(--text-neon)",
      marginBottom: 14
    }
  }, eyebrow), /*#__PURE__*/React.createElement("h1", {
    className: "hero-h1",
    style: {
      fontSize: "var(--size-display)",
      margin: 0,
      letterSpacing: "-.025em",
      lineHeight: 1.06
    }
  }, title), lede && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 18,
      lineHeight: 1.6,
      color: "var(--text-muted)",
      maxWidth: 640,
      margin: "18px 0 0"
    }
  }, lede), children));
}
Object.assign(window, {
  LangCtx,
  useX,
  Wordmark,
  Header,
  Footer,
  PageHero
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Chrome.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Effects.jsx
try { (() => {
// Scroll reveals only.
function FxLayer() {
  React.useEffect(() => {
    const io = new IntersectionObserver(es => es.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add("on");
        io.unobserve(en.target);
      }
    }), {
      threshold: .12
    });
    const scan = () => document.querySelectorAll("[data-reveal]:not(.on)").forEach(el => io.observe(el));
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.getElementById("root"), {
      childList: true,
      subtree: true
    });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);
  return null;
}
function Decrypt({
  text,
  className,
  style
}) {
  const [out, setOut] = React.useState(text);
  React.useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setOut(text);
      return;
    }
    const chars = "ACDEF0123456789$#/<>*+";
    let frame = 0,
      raf;
    const tick = () => {
      frame++;
      const reveal = Math.floor(frame / 2);
      setOut(text.split("").map((c, i) => c === " " ? " " : i < reveal ? c : chars[Math.random() * chars.length | 0]).join(""));
      if (reveal <= text.length) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return /*#__PURE__*/React.createElement("span", {
    className: className,
    style: style
  }, out);
}
function Counter({
  to,
  suffix = "",
  decimals = 0,
  duration = 1800
}) {
  const ref = React.useRef(null);
  const [v, setV] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    let raf,
      started = false;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(to);
      return;
    }
    const io = new IntersectionObserver(es => {
      if (es[0].isIntersecting && !started) {
        started = true;
        const t0 = performance.now();
        const step = t => {
          const k = Math.min(1, (t - t0) / duration);
          setV(to * (1 - Math.pow(1 - k, 3)));
          if (k < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      }
    }, {
      threshold: .4
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to]);
  const num = decimals ? v.toFixed(decimals) : Math.floor(v).toLocaleString("en-US").replace(/,/g, " ");
  return /*#__PURE__*/React.createElement("span", {
    ref: ref
  }, num, suffix);
}

// Twinkling multi-colour starfield behind the whole page (white / blue / magenta accent).
function Starfield() {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const cv = ref.current,
      ctx = cv.getContext("2d");
    const DPR = Math.min(devicePixelRatio || 1, 2);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const palette = [[255, 255, 255], [141, 225, 236], [244, 92, 176]]; // white, cyan-blue, magenta
    let w,
      h,
      stars = [],
      raf,
      t = 0;
    const build = () => {
      w = innerWidth;
      h = innerHeight;
      cv.width = w * DPR;
      cv.height = h * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      const n = Math.min(190, Math.floor(w * h / 9000));
      stars = Array.from({
        length: n
      }, () => {
        const r = Math.random();
        const ci = r < 0.72 ? 0 : r < 0.9 ? 1 : 2;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.3 + 0.35,
          c: palette[ci],
          ph: Math.random() * 6.283,
          sp: 0.5 + Math.random() * 1.7,
          base: 0.3 + Math.random() * 0.5
        };
      });
    };
    build();
    addEventListener("resize", build);
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        const a = reduce ? s.base : Math.max(0, Math.min(1, s.base + Math.sin(t * s.sp + s.ph) * 0.4));
        ctx.fillStyle = `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.283);
        ctx.fill();
        if (s.r > 1) {
          ctx.fillStyle = `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${a * 0.25})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 2.8, 0, 6.283);
          ctx.fill();
        }
      }
    };
    const frame = () => {
      t += 0.016;
      draw();
      raf = requestAnimationFrame(frame);
    };
    if (reduce) draw();else frame();
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", build);
    };
  }, []);
  return /*#__PURE__*/React.createElement("canvas", {
    ref: ref,
    "aria-hidden": "true",
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 0,
      pointerEvents: "none"
    }
  });
}
Object.assign(window, {
  FxLayer,
  Starfield,
  Decrypt,
  Counter
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Effects.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Features.jsx
try { (() => {
const {
  Badge,
  Icon,
  Card,
  FeatureTile,
  SectionHeader,
  Tag
} = window.CinderellaDesignSystem_593713;
function Features({
  nav
}) {
  const x = useX();
  const caps = [{
    icon: "shield-check",
    title: x("Consent-gated capture", "Zustimmungspflichtige Erfassung"),
    body: x("The bot joins a public group and asks before anything is read. Capture starts only after an explicit opt-in, and stops the moment consent is withdrawn.", "Der Bot tritt einer öffentlichen Gruppe bei und fragt, bevor irgendetwas gelesen wird. Die Erfassung beginnt erst nach ausdrücklichem Opt-in und endet, sobald die Zustimmung widerrufen wird."),
    chips: [x("Explicit opt-in", "Ausdrückliches Opt-in"), x("Revocable", "Widerrufbar"), x("Logged", "Protokolliert")]
  }, {
    icon: "shield-alert",
    dev: true,
    title: x("CSAM & content screening", "CSAM- & Inhaltsprüfung"),
    body: x("The heart of the firewall: every image and video is hashed and checked against known-abuse databases before it can be stored. Flagged media is blocked and never reaches the archive — the operator sees it in a review queue.", "Das Herz der Firewall: Jedes Bild und Video wird gehasht und gegen Datenbanken bekannten Missbrauchsmaterials geprüft, bevor es gespeichert werden kann. Markierte Medien werden blockiert und erreichen das Archiv nie — der Betreiber sieht sie in einer Prüf-Warteschlange."),
    chips: [x("Perceptual hashing", "Perceptual Hashing"), x("Known-abuse DBs", "Missbrauchs-DBs"), x("Blocked before storage", "Blockiert vor Speicherung")]
  }, {
    icon: "search",
    title: x("The public web archive", "Das öffentliche Web-Archiv"),
    body: x("Only what clears screening is published. What remains becomes permanent public pages: full-text search across every message, filters by group, author, date and media, infinite scroll, inline video, and SEO-friendly stable URLs.", "Nur was die Prüfung besteht, wird veröffentlicht. Was bleibt, wird zu dauerhaften öffentlichen Seiten: Volltextsuche über jede Nachricht, Filter nach Gruppe, Autor, Datum und Medien, endloses Scrollen, Video und SEO-freundliche stabile URLs."),
    chips: [x("Full-text search", "Volltextsuche"), x("Filters", "Filter"), x("Infinite scroll", "Endloses Scrollen"), "Video", "SEO"]
  }, {
    icon: "flag",
    title: x("Reporting & moderation", "Meldung & Moderation"),
    body: x("A second line after screening: anyone can report a published message. Reports reach the operator's console for review, takedown, and audit — moderation is a first-class workflow.", "Eine zweite Linie nach der Prüfung: Jede veröffentlichte Nachricht kann gemeldet werden. Meldungen erreichen die Operator-Konsole zur Prüfung, Entfernung und Auditierung — Moderation ist ein vollwertiger Workflow."),
    chips: [x("One-click reports", "Ein-Klick-Meldungen"), x("Operator review", "Operator-Prüfung"), x("Audit trail", "Audit-Trail")]
  }];
  const roadmap = [{
    icon: "tags",
    t: x("Categorization", "Kategorisierung"),
    d: x("Automatic topic grouping across archived content.", "Automatische thematische Gruppierung archivierter Inhalte.")
  }, {
    icon: "clapperboard",
    t: x("Video gallery", "Videogalerie"),
    d: x("A dedicated browsing surface for archived video.", "Eine eigene Oberfläche zum Durchstöbern archivierter Videos.")
  }, {
    icon: "gavel",
    t: x("Moderation tooling", "Moderationswerkzeuge"),
    d: x("Bulk actions, policies, and reviewer queues.", "Massenaktionen, Richtlinien und Prüf-Warteschlangen.")
  }, {
    icon: "cpu",
    t: x("Local AI", "Lokale KI"),
    d: x("Screening and summaries that run on your own hardware.", "Prüfung und Zusammenfassungen auf Ihrer eigenen Hardware.")
  }, {
    icon: "building-2",
    t: x("Multi-tenancy", "Mandantenfähigkeit"),
    d: x("One deployment, many isolated archives.", "Ein Deployment, viele isolierte Archive.")
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "screen"
  }, /*#__PURE__*/React.createElement(PageHero, {
    badge: /*#__PURE__*/React.createElement(Badge, {
      tone: "warning"
    }, "Alpha"),
    eyebrow: x("Features", "Funktionen"),
    title: /*#__PURE__*/React.createElement(React.Fragment, null, x("Everything runs through ", "Alles läuft durch "), /*#__PURE__*/React.createElement("span", {
      className: "grad-text"
    }, "Cinderella"), "."),
    lede: x("A firewall pipeline: consent, then CSAM and content screening, then — and only then — the public archive. Here is each stage.", "Eine Firewall-Pipeline: Zustimmung, dann CSAM- und Inhaltsprüfung, dann — und erst dann — das öffentliche Archiv. Hier ist jede Stufe.")
  }), /*#__PURE__*/React.createElement("section", {
    className: "band wrap",
    "data-reveal": true,
    style: {
      paddingTop: 64
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, caps.map((c, i) => /*#__PURE__*/React.createElement(Card, {
    key: c.title,
    padding: "lg",
    variant: c.dev ? "accent" : "default",
    style: {
      display: "flex",
      gap: 24,
      alignItems: "flex-start",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      width: 44,
      height: 44,
      flex: "none",
      borderRadius: "var(--radius-sm)",
      background: "var(--neon-weak)",
      border: "1px solid rgba(232,56,159,.2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--text-neon)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: c.icon,
    size: 22
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: -9,
      left: -9,
      width: 20,
      height: 20,
      borderRadius: 99,
      background: "var(--surface-card)",
      border: "1px solid var(--border-neutral)",
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      color: "var(--text-faint)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, i + 1)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "1 1 420px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 19,
      fontWeight: 700,
      color: "var(--text-bright)"
    }
  }, c.title), c.dev && /*#__PURE__*/React.createElement(Badge, {
    tone: "danger"
  }, x("In development", "In Entwicklung"))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.7,
      color: "var(--text-muted)",
      margin: "8px 0 14px",
      maxWidth: 660
    }
  }, c.body), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, c.chips.map(ch => /*#__PURE__*/React.createElement(Tag, {
    key: ch
  }, ch)))))))), /*#__PURE__*/React.createElement("section", {
    className: "band wrap",
    "data-reveal": true
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    eyebrow: x("Roadmap", "Roadmap"),
    title: x("Planned capabilities", "Geplante Fähigkeiten"),
    lede: x("In development or design. Order and scope may change — this is alpha software.", "In Entwicklung oder Konzeption. Reihenfolge und Umfang können sich ändern — dies ist Alpha-Software.")
  }), /*#__PURE__*/React.createElement("div", {
    className: "grid3",
    style: {
      marginTop: 36
    }
  }, roadmap.map(r => /*#__PURE__*/React.createElement(FeatureTile, {
    key: r.icon,
    icon: r.icon,
    title: r.t,
    badge: /*#__PURE__*/React.createElement(Badge, {
      tone: "outline"
    }, x("Planned", "Geplant"))
  }, r.d)))));
}
Object.assign(window, {
  Features
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Features.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Home.jsx
try { (() => {
const {
  Button,
  Badge,
  Icon,
  Card,
  FeatureTile,
  SectionHeader
} = window.CinderellaDesignSystem_593713;
function Home({
  nav
}) {
  const x = useX();
  const tiles = [{
    icon: "shield-alert",
    t: x("CSAM screening", "CSAM-Prüfung"),
    d: x("Every image and video is checked against known-abuse databases before it can ever reach the archive.", "Jedes Bild und Video wird gegen Datenbanken bekannten Missbrauchsmaterials geprüft, bevor es je ins Archiv gelangt.")
  }, {
    icon: "shield-check",
    t: x("Consent-first", "Zustimmung zuerst"),
    d: x("Nothing passes through without the group's explicit opt-in. Consent is checked before capture, never assumed.", "Nichts passiert ohne ausdrückliches Opt-in der Gruppe. Die Zustimmung wird vor der Erfassung geprüft, nie angenommen.")
  }, {
    icon: "lock",
    t: x("Secure by design", "Sicher konzipiert"),
    d: x("Passwordless passkeys, encrypted transport, media behind authentication, full audit logging.", "Passwortlose Passkeys, verschlüsselter Transport, Medien hinter Authentifizierung, lückenloses Audit-Logging.")
  }, {
    icon: "database",
    t: x("Then archived", "Dann archiviert"),
    d: x("Only what clears screening becomes a permanent, searchable public record.", "Nur was die Prüfung besteht, wird zu einem dauerhaften, durchsuchbaren öffentlichen Archiv.")
  }];
  const roadmap = [x("Categorization", "Kategorisierung"), x("Video gallery", "Videogalerie"), x("Moderation tooling", "Moderationswerkzeuge"), x("Local AI", "Lokale KI"), x("Multi-tenancy", "Mandantenfähigkeit")];
  const trust = [["shield-alert", x("CSAM screening", "CSAM-Prüfung")], ["shield-check", x("Consent-first", "Zustimmung zuerst")], ["key-round", x("Passkeys", "Passkeys")], ["cpu", x("Local AI", "Lokale KI")], ["git-branch", "AGPL-3.0"]];
  return /*#__PURE__*/React.createElement("div", {
    className: "screen"
  }, /*#__PURE__*/React.createElement("section", {
    className: "hero-bg fx-hero"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wrap hero-cine"
  }, /*#__PURE__*/React.createElement("div", {
    className: "htext"
  }, /*#__PURE__*/React.createElement("a", {
    className: "ann sym sym-left",
    href: "#/features",
    style: {
      animationDelay: "40ms"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ann-dot"
  }), /*#__PURE__*/React.createElement("span", null, x("Now in alpha · consent + CSAM screening", "Jetzt in Alpha · Zustimmungs- & CSAM-Prüfung")), /*#__PURE__*/React.createElement("span", {
    className: "ann-chip"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 13
  }))), /*#__PURE__*/React.createElement("h1", {
    className: "hero-h1",
    style: {
      margin: "18px 0 22px",
      letterSpacing: "-.03em"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "sym sym-blur",
    style: {
      display: "block",
      whiteSpace: "nowrap",
      animationDelay: "120ms"
    }
  }, x("Nothing is published", "Nichts wird veröffentlicht,")), /*#__PURE__*/React.createElement("span", {
    className: "grad-text sym sym-rise",
    style: {
      display: "block",
      whiteSpace: "nowrap",
      animationDelay: "240ms"
    }
  }, x("until it's screened.", "bis es geprüft ist."))), /*#__PURE__*/React.createElement("p", {
    className: "sym sym-left",
    style: {
      fontSize: 18,
      lineHeight: 1.6,
      color: "var(--text-muted)",
      maxWidth: 500,
      margin: 0,
      animationDelay: "380ms"
    }
  }, x("Cinderella is a firewall in front of the public archive: every message and file passes through consent checks and CSAM screening before anything ever goes live.", "Cinderella ist eine Firewall vor dem öffentlichen Archiv: Jede Nachricht und jede Datei durchläuft Zustimmungs- und CSAM-Prüfung, bevor irgendetwas online geht.")), /*#__PURE__*/React.createElement("div", {
    className: "sym sym-scale",
    style: {
      display: "flex",
      gap: 12,
      marginTop: 26,
      flexWrap: "wrap",
      animationDelay: "480ms"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    onClick: () => nav("security")
  }, x("See the safeguards", "Zu den Schutzmechanismen")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "lg",
    onClick: () => nav("features")
  }, x("Explore the archive", "Archiv erkunden"), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 15
  }))), /*#__PURE__*/React.createElement("div", {
    className: "trust sym sym-blur",
    style: {
      justifyContent: "flex-start",
      animationDelay: "580ms"
    }
  }, trust.map(([i, l]) => /*#__PURE__*/React.createElement("span", {
    key: l
  }, /*#__PURE__*/React.createElement(Icon, {
    name: i,
    size: 14,
    color: "var(--text-faint)"
  }), l)))), /*#__PURE__*/React.createElement("div", {
    className: "hero-stage sym sym-right",
    style: {
      animationDelay: "220ms"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pring"
  }, /*#__PURE__*/React.createElement("img", {
    src: window.__resources && window.__resources.avatar || "../../assets/cinderella_avatar.jpeg",
    alt: "Cinderella"
  }), /*#__PURE__*/React.createElement("span", {
    className: "pchip c1"
  }, /*#__PURE__*/React.createElement("span", {
    className: "d"
  }), x("consent verified", "Zustimmung geprüft")), /*#__PURE__*/React.createElement("span", {
    className: "pchip c2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "d"
  }), x("CSAM screened", "CSAM-geprüft")))))), /*#__PURE__*/React.createElement("section", {
    className: "band wrap",
    "data-reveal": true
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    eyebrow: x("The archive, live", "Das Archiv, live"),
    title: x("Search a permanent, public record", "Ein dauerhaftes, öffentliches Archiv durchsuchen"),
    lede: x("Full-text search, filters, and media behind authentication. Interactive preview with sample data.", "Volltextsuche, Filter und Medien hinter Authentifizierung. Interaktive Vorschau mit Beispieldaten.")
  }), /*#__PURE__*/React.createElement("div", {
    className: "hero-visual",
    style: {
      marginTop: 36
    }
  }, /*#__PURE__*/React.createElement(ArchiveDemo, null))), /*#__PURE__*/React.createElement("section", {
    className: "band wrap",
    "data-reveal": true
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    eyebrow: x("How it works", "So funktioniert es"),
    title: x("Screened before it's seen", "Geprüft, bevor es sichtbar wird"),
    lede: x("Everything flows through Cinderella first — consent, then content screening, then the public archive.", "Alles läuft zuerst durch Cinderella — Zustimmung, dann Inhaltsprüfung, dann das öffentliche Archiv."),
    align: "center"
  }), /*#__PURE__*/React.createElement("div", {
    className: "grid4",
    style: {
      marginTop: 48
    }
  }, tiles.map(t => /*#__PURE__*/React.createElement(FeatureTile, {
    key: t.icon,
    icon: t.icon,
    title: t.t
  }, t.d)))), /*#__PURE__*/React.createElement("section", {
    className: "band wrap",
    "data-reveal": true
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    eyebrow: x("The suite", "Die Suite"),
    title: x("The archive is the first capability", "Das Archiv ist die erste Fähigkeit"),
    lede: x("Cinderella is a growing suite of SimpleX bots. More is on the roadmap.", "Cinderella ist eine wachsende Suite von SimpleX-Bots. Weiteres steht auf der Roadmap.")
  }), /*#__PURE__*/React.createElement("div", {
    className: "grid2",
    style: {
      marginTop: 40,
      alignItems: "stretch"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: "var(--text-bright)"
    }
  }, x("Public web archive", "Öffentliches Web-Archiv")), /*#__PURE__*/React.createElement(Badge, {
    tone: "success"
  }, x("Live", "Aktiv"))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 15,
      lineHeight: 1.65,
      color: "var(--text-muted)",
      margin: "12px 0 18px"
    }
  }, x("Consent-gated capture, full-text search, filters, infinite scroll, video playback, and SEO-friendly public pages.", "Zustimmungspflichtige Erfassung, Volltextsuche, Filter, endloses Scrollen, Videowiedergabe und SEO-freundliche öffentliche Seiten.")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    onClick: () => nav("features")
  }, x("See all capabilities", "Alle Funktionen ansehen"), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 14
  }))), /*#__PURE__*/React.createElement(Card, {
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: "var(--text-bright)"
    }
  }, x("On the roadmap", "Auf der Roadmap")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 11,
      marginTop: 16
    }
  }, roadmap.map(r => /*#__PURE__*/React.createElement("div", {
    key: r,
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottom: "1px solid var(--border-neutral)",
      paddingBottom: 10,
      fontSize: 14
    }
  }, /*#__PURE__*/React.createElement("span", null, r), /*#__PURE__*/React.createElement(Badge, {
    tone: "outline"
  }, x("Planned", "Geplant")))))))), /*#__PURE__*/React.createElement("section", {
    className: "band wrap",
    "data-reveal": true
  }, /*#__PURE__*/React.createElement(Card, {
    padding: "lg",
    style: {
      display: "flex",
      gap: 48,
      alignItems: "center",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "1 1 340px"
    }
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    eyebrow: x("Security & safety", "Sicherheit & Schutz"),
    title: x("Your data stays yours", "Ihre Daten bleiben Ihre"),
    lede: x("Passwordless passkeys, encrypted transport, and AI that runs locally on your hardware — nothing leaves your infrastructure.", "Passwortlose Passkeys, verschlüsselter Transport und KI, die lokal auf Ihrer Hardware läuft — nichts verlässt Ihre Infrastruktur.")
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    style: {
      marginTop: 22
    },
    onClick: () => nav("security")
  }, x("Read the security model", "Zum Sicherheitsmodell"), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "1 1 300px",
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, [["key-round", x("Passwordless passkeys (WebAuthn)", "Passwortlose Passkeys (WebAuthn)")], ["lock", x("Encrypted in transit, hardened hosts", "Verschlüsselt übertragen, gehärtete Hosts")], ["cpu", x("Local AI — no third-party clouds", "Lokale KI — keine Dritt-Clouds")], ["flag", x("Content reporting & moderation", "Meldung & Moderation von Inhalten")]].map(([i, l]) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      gap: 11,
      alignItems: "center",
      fontSize: 15,
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: i,
    size: 17,
    color: "var(--text-accent)"
  }), l))))));
}
Object.assign(window, {
  Home
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Home.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Legal.jsx
try { (() => {
const {
  Tabs,
  Card,
  Badge
} = window.CinderellaDesignSystem_593713;
function Legal({
  route,
  nav
}) {
  const x = useX();
  const sub = route.split("/")[1] || "impressum";
  const setSub = id => {
    window.location.hash = "#/legal/" + id;
  };
  const PH = ({
    children
  }) => /*#__PURE__*/React.createElement("span", {
    className: "ph"
  }, "[", children, "]");
  const docs = {
    impressum: /*#__PURE__*/React.createElement("div", {
      className: "doc"
    }, /*#__PURE__*/React.createElement("h3", null, x("Legal Notice (Impressum)", "Impressum")), /*#__PURE__*/React.createElement("p", null, x("Information in accordance with § 5 TMG / § 18 MStV.", "Angaben gemäß § 5 TMG / § 18 MStV.")), /*#__PURE__*/React.createElement("h3", null, x("Operator", "Diensteanbieter")), /*#__PURE__*/React.createElement("p", null, "Sascha D\xE4mgen IT and More Systems", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement(PH, null, x("Street and number", "Straße und Hausnummer")), /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement(PH, null, x("Postal code, city", "PLZ, Ort")), /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement(PH, null, x("Country", "Land"))), /*#__PURE__*/React.createElement("h3", null, x("Contact", "Kontakt")), /*#__PURE__*/React.createElement("p", null, x("Email:", "E-Mail:"), " ", /*#__PURE__*/React.createElement(PH, null, "contact@example.org"), /*#__PURE__*/React.createElement("br", null), x("Phone (optional):", "Telefon (optional):"), " ", /*#__PURE__*/React.createElement(PH, null, "+49 \u2026")), /*#__PURE__*/React.createElement("h3", null, x("Responsible for content", "Verantwortlich für den Inhalt")), /*#__PURE__*/React.createElement("p", null, "Sascha D\xE4mgen", /*#__PURE__*/React.createElement(PH, null, x(", address as above", ", Anschrift wie oben"))), /*#__PURE__*/React.createElement("h3", null, x("Dispute resolution", "Streitschlichtung")), /*#__PURE__*/React.createElement("p", null, x("We are neither willing nor obliged to participate in dispute resolution proceedings before a consumer arbitration board.", "Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen."))),
    privacy: /*#__PURE__*/React.createElement("div", {
      className: "doc"
    }, /*#__PURE__*/React.createElement("h3", null, x("Privacy Policy", "Datenschutzerklärung")), /*#__PURE__*/React.createElement("p", null, x("Effective date:", "Stand:"), " ", /*#__PURE__*/React.createElement(PH, null, x("date", "Datum")), ". ", x("This policy explains what data this site and the Cinderella archive process, why, and for how long.", "Diese Erklärung beschreibt, welche Daten diese Website und das Cinderella-Archiv verarbeiten, zu welchem Zweck und wie lange.")), /*#__PURE__*/React.createElement("h3", null, x("1. Controller", "1. Verantwortlicher")), /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement(PH, null, x("Operator identity — same as Legal Notice", "Identität des Betreibers — wie im Impressum"))), /*#__PURE__*/React.createElement("h3", null, x("2. Archived content", "2. Archivierte Inhalte")), /*#__PURE__*/React.createElement("p", null, x("The archive stores messages from public SimpleX groups that have explicitly consented to capture. Legal basis:", "Das Archiv speichert Nachrichten öffentlicher SimpleX-Gruppen, die der Erfassung ausdrücklich zugestimmt haben. Rechtsgrundlage:"), " ", /*#__PURE__*/React.createElement(PH, null, "Art. 6(1) GDPR"), ". ", x("Content can be reported and removed via the reporting workflow.", "Inhalte können über den Melde-Workflow gemeldet und entfernt werden.")), /*#__PURE__*/React.createElement("h3", null, x("3. Site visitors", "3. Website-Besucher")), /*#__PURE__*/React.createElement("p", null, x("The public site sets a session cookie for operator login and counts anonymous usage. No tracking pixels, no third-party advertising, no cross-site profiles.", "Die öffentliche Website setzt ein Sitzungs-Cookie für den Operator-Login und zählt anonyme Nutzung. Keine Tracking-Pixel, keine Fremdwerbung, keine seitenübergreifenden Profile.")), /*#__PURE__*/React.createElement("h3", null, x("4. Storage & processing location", "4. Speicherung & Verarbeitungsort")), /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement(PH, null, x("Hosting provider / location; note that AI processing runs locally", "Hosting-Anbieter / Ort; Hinweis, dass KI-Verarbeitung lokal erfolgt"))), /*#__PURE__*/React.createElement("h3", null, x("5. Your rights", "5. Ihre Rechte")), /*#__PURE__*/React.createElement("p", null, x("Access, rectification, erasure, restriction, portability, objection — contact the operator. You may lodge a complaint with a supervisory authority.", "Auskunft, Berichtigung, Löschung, Einschränkung, Übertragbarkeit, Widerspruch — wenden Sie sich an den Betreiber. Beschwerden sind bei einer Aufsichtsbehörde möglich."))),
    terms: /*#__PURE__*/React.createElement("div", {
      className: "doc"
    }, /*#__PURE__*/React.createElement("h3", null, x("Terms of Use", "Nutzungsbedingungen")), /*#__PURE__*/React.createElement("p", null, x("Effective date:", "Stand:"), " ", /*#__PURE__*/React.createElement(PH, null, x("date", "Datum"))), /*#__PURE__*/React.createElement("h3", null, x("1. Scope", "1. Geltungsbereich")), /*#__PURE__*/React.createElement("p", null, x("These terms govern use of the public archive and the operator console. The software itself is licensed separately under AGPL-3.0.", "Diese Bedingungen regeln die Nutzung des öffentlichen Archivs und der Operator-Konsole. Die Software selbst ist separat unter AGPL-3.0 lizenziert.")), /*#__PURE__*/React.createElement("h3", null, x("2. Alpha status", "2. Alpha-Status")), /*#__PURE__*/React.createElement("p", null, x("The service is provided in an early alpha state, without warranty of availability or fitness. Features may change or be removed.", "Der Dienst befindet sich in einer frühen Alpha-Phase und wird ohne Gewähr für Verfügbarkeit oder Eignung bereitgestellt. Funktionen können sich ändern oder entfallen.")), /*#__PURE__*/React.createElement("h3", null, x("3. Acceptable use", "3. Zulässige Nutzung")), /*#__PURE__*/React.createElement("p", null, x("No scraping beyond published interfaces, no attempts to access non-public data, no abuse of the reporting system.", "Kein Scraping jenseits der veröffentlichten Schnittstellen, keine Zugriffsversuche auf nicht-öffentliche Daten, kein Missbrauch des Meldesystems.")), /*#__PURE__*/React.createElement("h3", null, x("4. Content & takedowns", "4. Inhalte & Entfernungen")), /*#__PURE__*/React.createElement("p", null, x("Archived content originates from consenting public groups. The operator may remove content following reports or legal obligation.", "Archivierte Inhalte stammen aus zustimmenden öffentlichen Gruppen. Der Betreiber kann Inhalte nach Meldungen oder rechtlicher Verpflichtung entfernen.")), /*#__PURE__*/React.createElement("h3", null, x("5. Liability", "5. Haftung")), /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement(PH, null, x("Liability clause to be provided by counsel", "Haftungsklausel — durch Rechtsberatung zu ergänzen"))))
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "screen"
  }, /*#__PURE__*/React.createElement(PageHero, {
    eyebrow: x("Legal", "Rechtliches"),
    title: x("Legal information", "Rechtliche Informationen"),
    lede: x("Placeholder texts — have counsel review before launch. Highlighted fields must be completed.", "Platzhaltertexte — vor dem Livegang juristisch prüfen lassen. Markierte Felder sind auszufüllen.")
  }), /*#__PURE__*/React.createElement("section", {
    className: "wrap",
    style: {
      paddingTop: 40
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: sub,
    onChange: setSub,
    items: [{
      id: "impressum",
      label: x("Legal Notice", "Impressum")
    }, {
      id: "privacy",
      label: x("Privacy Policy", "Datenschutzerklärung")
    }, {
      id: "terms",
      label: x("Terms", "Nutzungsbedingungen")
    }]
  }), /*#__PURE__*/React.createElement(Card, {
    variant: "quiet",
    padding: "lg",
    style: {
      marginTop: 24,
      maxWidth: 860
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "outline"
  }, x("Template — not legal advice", "Vorlage — keine Rechtsberatung")), docs[sub] || docs.impressum)));
}
Object.assign(window, {
  Legal
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Legal.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Login.jsx
try { (() => {
const {
  Button,
  Input,
  Icon,
  Card,
  Badge
} = window.CinderellaDesignSystem_593713;
function Login({
  nav
}) {
  const x = useX();
  const [state, setState] = React.useState("idle");
  return /*#__PURE__*/React.createElement("div", {
    className: "screen",
    style: {
      minHeight: "62vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "72px 24px"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: "lg",
    style: {
      width: 400,
      maxWidth: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    size: 24
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--text-faint)",
      marginTop: 6
    }
  }, x("Operator console", "Operator-Konsole"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14,
      marginTop: 26
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    onClick: () => setState("waiting")
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "key-round",
    size: 17
  }), " ", x("Sign in with passkey", "Mit Passkey anmelden")), state === "waiting" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      justifyContent: "center",
      fontSize: 13,
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 99,
      background: "var(--accent)",
      boxShadow: "var(--glow-accent)",
      animation: "screenIn 1s infinite alternate"
    }
  }), x("Waiting for your authenticator…", "Warte auf Ihren Authenticator …")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      color: "var(--text-faint)",
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: "var(--border-neutral)"
    }
  }), x("or", "oder"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: "var(--border-neutral)"
    }
  })), /*#__PURE__*/React.createElement(Input, {
    label: x("Username", "Benutzername"),
    placeholder: "operator",
    hint: x("For accounts registered before passkeys", "Für Konten aus der Zeit vor Passkeys")
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true
  }, x("Continue", "Weiter"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 22,
      paddingTop: 16,
      borderTop: "1px solid var(--border-neutral)",
      fontSize: 12.5,
      color: "var(--text-faint)",
      lineHeight: 1.6
    }
  }, x("No password exists for this console — access is passkey-only, by operator invitation. ", "Für diese Konsole existiert kein Passwort — Zugang nur per Passkey, auf Einladung des Betreibers. "), /*#__PURE__*/React.createElement("a", {
    href: "#/security"
  }, x("Why?", "Warum?")))));
}
Object.assign(window, {
  Login
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Login.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/OpenSource.jsx
try { (() => {
const {
  Badge,
  Icon,
  Card,
  SectionHeader,
  Button,
  FeatureTile
} = window.CinderellaDesignSystem_593713;
function OpenSource({
  nav
}) {
  const x = useX();
  const steps = [[x("Clone", "Klonen"), "git clone https://github.com/&lt;org&gt;/cinderella"], [x("Configure", "Konfigurieren"), "cp .env.example .env  # bot address, archive domain"], [x("Run", "Starten"), "docker compose up -d"]];
  return /*#__PURE__*/React.createElement("div", {
    className: "screen"
  }, /*#__PURE__*/React.createElement(PageHero, {
    badge: /*#__PURE__*/React.createElement(Badge, null, "AGPL-3.0"),
    eyebrow: "Open Source",
    title: x("Open core, open books", "Offener Kern, offene Bücher"),
    lede: x("Cinderella's core is free software under AGPL-3.0. Run it yourself, read every line, and hold us to what this site claims.", "Der Kern von Cinderella ist freie Software unter AGPL-3.0. Betreiben Sie sie selbst, lesen Sie jede Zeile — und messen Sie uns an dem, was diese Seite behauptet.")
  }), /*#__PURE__*/React.createElement("section", {
    className: "band wrap",
    "data-reveal": true,
    style: {
      paddingTop: 64
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid2",
    style: {
      alignItems: "stretch"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "github",
    size: 22,
    color: "var(--text-accent)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 17,
      fontWeight: 700,
      color: "var(--text-bright)"
    }
  }, x("The repository", "Das Repository"))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.7,
      color: "var(--text-muted)",
      margin: "10px 0 16px"
    }
  }, x("Source, issues, roadmap discussions, and the security policy live on GitHub. Contributions are welcome — from typo fixes to capabilities.", "Quellcode, Issues, Roadmap-Diskussionen und die Security-Richtlinie liegen auf GitHub. Beiträge sind willkommen — vom Tippfehler bis zur neuen Fähigkeit.")), /*#__PURE__*/React.createElement(Button, null, x("View on GitHub", "Auf GitHub ansehen"), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "external-link",
    size: 14
  }))), /*#__PURE__*/React.createElement(Card, {
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 17,
      fontWeight: 700,
      color: "var(--text-bright)"
    }
  }, x("Why AGPL-3.0", "Warum AGPL-3.0")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.7,
      color: "var(--text-muted)",
      margin: "10px 0 0"
    }
  }, x("An archive asks for trust. The AGPL guarantees that anyone operating a modified Cinderella must publish those modifications — the public can always inspect the code that handles public conversations.", "Ein Archiv verlangt Vertrauen. Die AGPL garantiert: Wer eine veränderte Cinderella betreibt, muss diese Änderungen veröffentlichen — der Code, der öffentliche Unterhaltungen verarbeitet, bleibt überprüfbar."))))), /*#__PURE__*/React.createElement("section", {
    className: "band wrap",
    "data-reveal": true
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    eyebrow: x("Self-hosting", "Selbst betreiben"),
    title: x("Run it yourself", "Selbst betreiben"),
    lede: x("Three steps to your own archive. Details in the docs.", "Drei Schritte zum eigenen Archiv. Details in der Doku.")
  }), /*#__PURE__*/React.createElement("div", {
    className: "grid3",
    style: {
      marginTop: 36
    }
  }, steps.map(([t, code], i) => /*#__PURE__*/React.createElement(Card, {
    key: t
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-accent)",
      marginBottom: 8
    }
  }, "0", i + 1), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      color: "var(--text-bright)",
      marginBottom: 10
    }
  }, t), /*#__PURE__*/React.createElement("div", {
    className: "mono-block",
    style: {
      fontSize: 12
    },
    dangerouslySetInnerHTML: {
      __html: code
    }
  })))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: "var(--text-faint)",
      marginTop: 16
    }
  }, x("Placeholder commands — the repository README is authoritative.", "Platzhalter-Befehle — maßgeblich ist die README im Repository."))));
}
Object.assign(window, {
  OpenSource
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/OpenSource.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Pro.jsx
try { (() => {
const {
  Button,
  Badge,
  Card,
  FeatureTile,
  SectionHeader,
  PricingTier,
  Input
} = window.CinderellaDesignSystem_593713;
function Pro({
  nav
}) {
  const x = useX();
  return /*#__PURE__*/React.createElement("div", {
    className: "screen"
  }, /*#__PURE__*/React.createElement(PageHero, {
    badge: /*#__PURE__*/React.createElement(Badge, {
      tone: "accent"
    }, "Pro"),
    eyebrow: x("The commercial edition", "Die kommerzielle Edition"),
    title: x("Cinderella Pro", "Cinderella Pro"),
    lede: x("Managed hosting and capabilities beyond the open core — for operators who want the archive without running the infrastructure.", "Verwaltetes Hosting und Fähigkeiten über den offenen Kern hinaus — für Betreiber, die das Archiv ohne eigene Infrastruktur wollen.")
  }), /*#__PURE__*/React.createElement("section", {
    className: "band wrap",
    "data-reveal": true,
    style: {
      paddingTop: 64
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid3"
  }, /*#__PURE__*/React.createElement(FeatureTile, {
    icon: "server",
    title: x("Managed hosting", "Verwaltetes Hosting")
  }, x("We run the bots, the archive, and the updates. You keep operational control and your data.", "Wir betreiben Bots, Archiv und Updates. Sie behalten die operative Kontrolle und Ihre Daten.")), /*#__PURE__*/React.createElement(FeatureTile, {
    icon: "layers",
    title: x("Beyond the open core", "Über den offenen Kern hinaus")
  }, x("Pro-only capabilities land here first: advanced moderation, analytics, and multi-archive management.", "Pro-Funktionen erscheinen hier zuerst: erweiterte Moderation, Auswertungen und Verwaltung mehrerer Archive.")), /*#__PURE__*/React.createElement(FeatureTile, {
    icon: "life-buoy",
    title: x("Support that answers", "Support, der antwortet")
  }, x("Direct channel to the people who build Cinderella, with response targets.", "Direkter Draht zu den Entwicklern von Cinderella, mit Reaktionszeiten.")))), /*#__PURE__*/React.createElement("section", {
    className: "band wrap",
    "data-reveal": true
  }, /*#__PURE__*/React.createElement(SectionHeader, {
    eyebrow: x("Pricing", "Preise"),
    title: x("Plans", "Pläne"),
    lede: x("Pricing is being finalized during the alpha. Figures below are placeholders.", "Die Preise werden während der Alpha festgelegt. Die folgenden Angaben sind Platzhalter.")
  }), /*#__PURE__*/React.createElement("div", {
    className: "grid3",
    style: {
      marginTop: 36,
      alignItems: "stretch"
    }
  }, /*#__PURE__*/React.createElement(PricingTier, {
    name: x("Self-host", "Self-Host"),
    price: "\u20AC0",
    period: x("forever", "für immer"),
    description: x("The full open core, AGPL-3.0. Your hardware, your rules.", "Der volle offene Kern, AGPL-3.0. Ihre Hardware, Ihre Regeln."),
    features: [x("Archive bot & public site", "Archiv-Bot & öffentliche Seite"), x("Passkey operator console", "Passkey-Operator-Konsole"), x("Community support", "Community-Support")],
    cta: x("View on GitHub", "Auf GitHub ansehen"),
    onCta: () => nav("open-source")
  }), /*#__PURE__*/React.createElement(PricingTier, {
    name: "Pro",
    price: x("TBA", "TBA"),
    period: x("/ month", "/ Monat"),
    highlight: true,
    badge: /*#__PURE__*/React.createElement(Badge, {
      tone: "accent"
    }, x("Recommended", "Empfohlen")),
    description: x("Managed hosting plus Pro capabilities, run for you.", "Verwaltetes Hosting plus Pro-Funktionen, für Sie betrieben."),
    features: [x("Everything in Self-host", "Alles aus Self-Host"), x("Managed hosting & updates", "Verwaltetes Hosting & Updates"), x("Advanced moderation & analytics", "Erweiterte Moderation & Auswertungen"), x("Priority support", "Prioritäts-Support")],
    cta: x("Join the waitlist", "Auf die Warteliste")
  }), /*#__PURE__*/React.createElement(PricingTier, {
    name: "Enterprise",
    price: x("Custom", "Individuell"),
    description: x("Multiple archives, custom terms, and deployment assistance.", "Mehrere Archive, individuelle Konditionen und Unterstützung beim Deployment."),
    features: [x("Everything in Pro", "Alles aus Pro"), x("Multi-tenancy (roadmap)", "Mandantenfähigkeit (Roadmap)"), x("Custom SLAs", "Individuelle SLAs")],
    cta: x("Contact us", "Kontakt aufnehmen")
  }))), /*#__PURE__*/React.createElement("section", {
    className: "band wrap",
    "data-reveal": true
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "accent",
    padding: "lg",
    style: {
      display: "flex",
      gap: 32,
      alignItems: "center",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "1 1 320px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 20,
      fontWeight: 700,
      color: "var(--text-bright)"
    }
  }, x("Already a customer?", "Bereits Kunde?")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: "var(--text-muted)",
      margin: "8px 0 0",
      lineHeight: 1.6
    }
  }, x("Sign in to your Pro workspace, or leave an address and we'll write when onboarding opens.", "Melden Sie sich in Ihrem Pro-Arbeitsbereich an — oder hinterlassen Sie eine Adresse, wir schreiben, sobald das Onboarding öffnet."))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      alignItems: "flex-end",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: x("Email", "E-Mail"),
    placeholder: "you@example.org",
    style: {
      width: 220
    }
  }), /*#__PURE__*/React.createElement(Button, null, x("Request access", "Zugang anfragen")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: () => nav("login")
  }, x("Customer login", "Kunden-Login"))))));
}
Object.assign(window, {
  Pro
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Pro.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Security.jsx
try { (() => {
const {
  Badge,
  Icon,
  Card,
  FeatureTile,
  Button
} = window.CinderellaDesignSystem_593713;
function Security({
  nav
}) {
  const x = useX();
  const tiles = [{
    icon: "key-round",
    t: x("Passwordless", "Passwortlos"),
    d: x("Passkeys (WebAuthn / FIDO2) — device-bound, phishing- and brute-force-resistant. No shared passwords.", "Passkeys (WebAuthn / FIDO2) — gerätegebunden, phishing- und brute-force-resistent. Keine geteilten Passwörter.")
  }, {
    icon: "server",
    t: x("Your data stays yours", "Ihre Daten bleiben Ihre"),
    d: x("Least-privilege and isolated. With the planned local AI, screening and conversations never leave your infrastructure.", "Least-Privilege und isoliert. Mit der geplanten lokalen KI verlassen Prüfung und Unterhaltungen nie Ihre Infrastruktur.")
  }, {
    icon: "flag",
    t: x("Reporting & takedown", "Meldung & Entfernung"),
    d: x("A second line after screening: anyone can report published content; the operator reviews and removes it, every action audit-logged.", "Zweite Linie nach der Prüfung: Jeder kann veröffentlichte Inhalte melden; der Betreiber prüft und entfernt sie — jede Aktion audit-protokolliert.")
  }];
  const flow = [{
    t: x("Consent", "Zustimmung"),
    i: "shield-check"
  }, {
    t: x("CSAM screen", "CSAM-Prüfung"),
    i: "shield-alert",
    on: true
  }, {
    t: x("Publish", "Veröffentlichen"),
    i: "globe"
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "screen"
  }, /*#__PURE__*/React.createElement(PageHero, {
    eyebrow: x("Security & safety", "Sicherheit & Schutz"),
    title: /*#__PURE__*/React.createElement(React.Fragment, null, x("Security is ", "Sicherheit ist "), /*#__PURE__*/React.createElement("span", {
      className: "grad-text"
    }, x("the point", "der Kern")), x(", not a feature.", ", kein Feature.")),
    lede: x("Cinderella is a screening firewall: every message and file runs through consent and CSAM detection before it can be published. Here is how that is built.", "Cinderella ist eine Prüf-Firewall: Jede Nachricht und jede Datei durchläuft Zustimmung und CSAM-Erkennung, bevor sie veröffentlicht werden kann. So ist das gebaut.")
  }), /*#__PURE__*/React.createElement("section", {
    className: "band wrap",
    style: {
      paddingTop: 48
    },
    "data-reveal": true
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "accent",
    padding: "lg",
    style: {
      display: "flex",
      gap: 36,
      flexWrap: "wrap",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "1 1 360px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 44,
      height: 44,
      borderRadius: "var(--radius-sm)",
      background: "var(--neon-weak)",
      border: "1px solid rgba(232,56,159,.28)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--text-neon)",
      boxShadow: "var(--edge-lit),var(--glow-neon-sm)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "shield-alert",
    size: 22
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap",
      margin: "16px 0 0"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 22,
      fontWeight: 700,
      color: "var(--text-bright)"
    }
  }, x("CSAM & content screening", "CSAM- & Inhaltsprüfung")), /*#__PURE__*/React.createElement(Badge, {
    tone: "danger"
  }, x("In development", "In Entwicklung"))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 15,
      lineHeight: 1.65,
      color: "var(--text-muted)",
      margin: "10px 0 0",
      maxWidth: 520
    }
  }, x("This is the point of Cinderella. Every image and video is hashed and matched against known-abuse databases before it can be stored. Flagged media is blocked at the firewall and never reaches the public archive — it surfaces only in the operator's review queue.", "Das ist der Sinn von Cinderella. Jedes Bild und Video wird gehasht und gegen Datenbanken bekannten Missbrauchsmaterials abgeglichen, bevor es gespeichert werden kann. Markierte Medien werden an der Firewall blockiert und erreichen das öffentliche Archiv nie — sie erscheinen nur in der Prüf-Warteschlange des Betreibers."))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "1 1 280px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      flexWrap: "wrap"
    }
  }, flow.map((f, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: f.i
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      padding: "16px 14px",
      borderRadius: "var(--radius-md)",
      border: `1px solid ${f.on ? "rgba(232,56,159,.45)" : "var(--border-neutral)"}`,
      background: f.on ? "var(--neon-weak)" : "var(--surface-field)",
      boxShadow: f.on ? "var(--glow-neon-sm)" : "none",
      minWidth: 92
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: f.i,
    size: 20,
    color: f.on ? "var(--text-neon)" : "var(--text-muted)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: f.on ? "var(--text-neon)" : "var(--text-muted)",
      marginTop: 8
    }
  }, f.t)), i < flow.length - 1 && /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 16,
    color: "var(--text-faint)"
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "grid3",
    style: {
      marginTop: 16,
      alignItems: "start"
    }
  }, tiles.map(c => /*#__PURE__*/React.createElement(FeatureTile, {
    key: c.icon,
    icon: c.icon,
    title: c.t
  }, c.d)))), /*#__PURE__*/React.createElement("section", {
    className: "band wrap",
    "data-reveal": true
  }, /*#__PURE__*/React.createElement(Card, {
    padding: "lg",
    style: {
      display: "flex",
      gap: 32,
      alignItems: "center",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bug",
    size: 26,
    color: "var(--text-accent)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "1 1 320px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 17,
      fontWeight: 700,
      color: "var(--text-bright)"
    }
  }, x("Found a vulnerability?", "Eine Schwachstelle gefunden?")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: "var(--text-muted)",
      margin: "6px 0 0",
      lineHeight: 1.6
    }
  }, x("Report it privately via the security contact in the repository. We credit responsible disclosure.", "Melden Sie sie vertraulich über den Security-Kontakt im Repository. Verantwortungsvolle Meldungen werden genannt."))), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: () => nav("open-source")
  }, x("Security policy", "Security-Richtlinie"), " ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 14
  })))));
}
Object.assign(window, {
  Security
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Security.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.CookieBanner = __ds_scope.CookieBanner;

__ds_ns.FeatureTile = __ds_scope.FeatureTile;

__ds_ns.PricingTier = __ds_scope.PricingTier;

__ds_ns.SectionHeader = __ds_scope.SectionHeader;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
