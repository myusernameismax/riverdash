// Update a container to match new HTML while keeping the existing elements
// where they still fit. That keeps canvases, text fields (and the keyboard) and
// running CSS transitions alive across re-renders. Elements with a data-key are
// only reused for the same key.

const tpl = document.createElement("template");

export function morphInto(container, html) {
    tpl.innerHTML = html;
    morphChildren(container, tpl.content);
}

function same(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType !== 1) return true;
    return a.tagName === b.tagName && (a.getAttribute("data-key") || "") === (b.getAttribute("data-key") || "");
}

function morphChildren(from, to) {
    const want = [...to.childNodes];
    let cur = from.firstChild;
    for (const n of want) {
        if (cur && same(cur, n)) {
            morphNode(cur, n);
            cur = cur.nextSibling;
        } else {
            from.insertBefore(n, cur);   // moves n out of the template
        }
    }
    while (cur) { const next = cur.nextSibling; from.removeChild(cur); cur = next; }
}

function morphNode(a, b) {
    if (a.nodeType === 3 || a.nodeType === 8) {
        if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
        return;
    }
    if (a.nodeType !== 1) return;
    // attributes
    for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
    for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
    if (a.hasAttribute("data-keep")) return;   // contents managed elsewhere
    if (a.tagName === "svg" || a.namespaceURI === "http://www.w3.org/2000/svg") {
        if (a.innerHTML !== b.innerHTML) a.innerHTML = b.innerHTML;
        return;
    }
    morphChildren(a, b);
}
