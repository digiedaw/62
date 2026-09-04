// Remark plugin: turns :::type[Title] blocks into <aside class="admonition"> HTML.
// Requires `remark-directive` to be loaded first.
import { visit } from "unist-util-visit";

const VALID = new Set(["note","tip","info","warning","danger","success","important","caution"]);
const ICONS = { note:"📝", tip:"💡", info:"ℹ️", warning:"⚠️", danger:"🚨", success:"✅", important:"❗", caution:"⚠️" };
const DEFAULTS = { note:"Note", tip:"Tip", info:"Info", warning:"Warning", danger:"Danger", success:"Success", important:"Important", caution:"Caution" };

export function remarkAdmonition() {
  return (tree) => {
    visit(tree, (node) => {
      if (!node.children) return;
      for (let i = 0; i < node.children.length; i++) {
        const c = node.children[i];
        if (c.type !== "containerDirective" || !VALID.has(c.name)) continue;
        const type = c.name;
        let title = DEFAULTS[type];
        if (c.children?.[0]?.type === "paragraph") {
          const txt = (c.children[0].children || []).map(x => x.value || "").join("").trim();
          if (txt && txt.length < 60 && !/[.!?]/.test(txt)) {
            title = txt;
            c.children.shift();
          }
        }
        const icon = ICONS[type];
        const inner = stringifyChildren(c);
        node.children[i] = {
          type: "html",
          value:
            `<aside class="admonition admonition-${type}">` +
            `<div class="admonition-heading">` +
            `<span class="admonition-icon" aria-hidden="true">${icon}</span>` +
            `<span class="admonition-title">${title}</span>` +
            `</div>` +
            `<div class="admonition-content">${inner}</div>` +
            `</aside>`,
        };
      }
    });
  };
}

function stringifyChildren(node) {
  if (!node.children) return "";
  return node.children.map(stringifyNode).join("");
}

function stringifyNode(node) {
  if (node.type === "text") return esc(node.value);
  if (node.type === "paragraph") return `<p>${stringifyChildren(node)}</p>`;
  if (node.type === "list") {
    const tag = node.ordered ? "ol" : "ul";
    return `<${tag}>${stringifyChildren(node)}</${tag}>`;
  }
  if (node.type === "listItem") return `<li>${stringifyChildren(node)}</li>`;
  if (node.type === "strong") return `<strong>${stringifyChildren(node)}</strong>`;
  if (node.type === "emphasis") return `<em>${stringifyChildren(node)}</em>`;
  if (node.type === "inlineCode") return `<code>${esc(node.value)}</code>`;
  if (node.type === "code") return `<pre><code>${esc(node.value)}</code></pre>`;
  if (node.type === "link") return `<a href="${esc(node.url)}">${stringifyChildren(node)}</a>`;
  if (node.type === "heading") return `<h${node.depth}>${stringifyChildren(node)}</h${node.depth}>`;
  if (node.type === "break") return "<br/>";
  if (node.type === "html") return node.value;
  if (node.children) return stringifyChildren(node);
  return "";
}

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
