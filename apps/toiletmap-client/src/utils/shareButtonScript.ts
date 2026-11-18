/**
 * The blog post's Share button script (src/pages/posts/[...slug].astro renders it inline with
 * `set:html`), kept here so the Content Security Policy can allow exactly this text by its
 * hash (src/utils/inlineScripts.ts).
 *
 * The native share sheet, where the browser has one (most phones). Without it, or without
 * JavaScript, the button stays hidden and the Bluesky link is still there. Inline (not a
 * bundled script) because Vite inlines it into the prerendered page anyway, and a bundled copy
 * leaves a dangling _astro/ entry in the server manifest that check-build-assets flags.
 */
export const SHARE_BUTTON_SCRIPT = `
for (const button of document.querySelectorAll(".post__share-native")) {
  if (typeof navigator.share !== "function") continue;
  button.hidden = false;
  button.addEventListener("click", () => {
    navigator
      .share({
        title: button.dataset.shareTitle,
        text: "Check out this post on the Toilet Map blog",
        url: button.dataset.shareUrl,
      })
      .catch(() => {
        // Dismissed by the visitor, or not allowed: nothing to do.
      });
  });
}
`;
