(function () {
  let registered = false;

  function register(Quill) {
    if (registered || !Quill) return;
    const Inline = Quill.import("blots/inline");
    class ReviewCommentBlot extends Inline {
      static create(value) {
        const node = super.create();
        node.setAttribute("data-review-comment", String(value || ""));
        return node;
      }
      static formats(node) {
        return node.getAttribute("data-review-comment") || true;
      }
      format(name, value) {
        if (name === ReviewCommentBlot.blotName && value) {
          this.domNode.setAttribute("data-review-comment", String(value));
          return;
        }
        super.format(name, value);
      }
    }
    ReviewCommentBlot.blotName = "reviewComment";
    ReviewCommentBlot.tagName = "SPAN";
    ReviewCommentBlot.className = "rw-review-highlight";
    Quill.register(ReviewCommentBlot, true);
    registered = true;
  }

  function cleanHtml(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll(".rw-review-highlight").forEach((node) => node.replaceWith(...node.childNodes));
    return clone.innerHTML;
  }

  function reanchor(comment, text) {
    const quote = String(comment.selected_text || "");
    let start = Number(comment.anchor_start || 0);
    let length = Math.max(1, Number(comment.anchor_length || quote.length || 1));
    if (quote && text.slice(start, start + quote.length) === quote) {
      length = quote.length;
    } else if (quote) {
      const matches = [];
      let at = text.indexOf(quote);
      while (at !== -1 && matches.length < 100) {
        matches.push(at);
        at = text.indexOf(quote, at + 1);
      }
      if (matches.length) {
        const prefix = String(comment.prefix_text || "");
        const suffix = String(comment.suffix_text || "");
        const score = (position) => {
          let points = -Math.abs(position - start) / Math.max(text.length, 1);
          if (prefix && text.slice(Math.max(0, position - prefix.length), position) === prefix) points += 4;
          if (suffix && text.slice(position + quote.length, position + quote.length + suffix.length) === suffix) points += 4;
          return points;
        };
        start = matches.sort((a, b) => score(b) - score(a))[0];
        length = quote.length;
      } else {
        comment.anchor_state = "missing";
        return comment;
      }
    }
    comment.anchor_start = Math.max(0, Math.min(start, Math.max(0, text.length - 1)));
    comment.anchor_length = Math.max(1, Math.min(length, text.length - comment.anchor_start));
    comment.anchor_state = "found";
    return comment;
  }

  function refreshAnchorText(comment, text) {
    const start = Math.max(0, Number(comment.anchor_start || 0));
    const length = Math.max(1, Number(comment.anchor_length || 1));
    comment.selected_text = text.slice(start, start + length);
    comment.prefix_text = text.slice(Math.max(0, start - 80), start);
    comment.suffix_text = text.slice(start + length, start + length + 80);
    return comment;
  }

  function transformAnchors(comments, delta, text) {
    if (!delta || typeof delta.transformPosition !== "function") return comments;
    for (const comment of comments) {
      if (comment.status === "resolved" || comment.anchor_state === "missing") continue;
      const start = Number(comment.anchor_start || 0);
      const end = start + Math.max(1, Number(comment.anchor_length || 1));
      const nextStart = delta.transformPosition(start, true);
      const nextEnd = delta.transformPosition(end, false);
      comment.anchor_start = Math.max(0, nextStart);
      comment.anchor_length = Math.max(1, nextEnd - nextStart);
      refreshAnchorText(comment, text);
    }
    return comments;
  }

  function setActive(root, activeId) {
    root.querySelectorAll(".rw-review-highlight").forEach((node) => {
      node.classList.toggle("is-active", String(node.dataset.reviewComment) === String(activeId || ""));
    });
  }

  function applyHighlights(quill, comments, activeId) {
    const length = Math.max(0, quill.getLength() - 1);
    quill.formatText(0, length, "reviewComment", false, "silent");
    for (const comment of comments) {
      if (comment.status === "resolved" || comment.anchor_state === "missing") continue;
      const start = Number(comment.anchor_start || 0);
      const span = Math.min(Number(comment.anchor_length || 0), Math.max(0, length - start));
      if (span > 0) quill.formatText(start, span, "reviewComment", comment.id, "silent");
    }
    setActive(quill.root, activeId);
  }

  function focus(quill, comment, activeId) {
    applyHighlights(quill, [comment], activeId || comment.id);
    const leaf = quill.getLeaf(Number(comment.anchor_start || 0));
    const node = leaf?.[0]?.domNode;
    const target = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    quill.setSelection(Number(comment.anchor_start || 0), Math.max(1, Number(comment.anchor_length || 1)), "silent");
  }

  window.REVIEW_COMMENTS = {
    register,
    cleanHtml,
    reanchor,
    refreshAnchorText,
    transformAnchors,
    applyHighlights,
    setActive,
    focus
  };
})();
