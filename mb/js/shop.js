/* ============ Shop ============ */
/* Rendered from products.json — managed via shop-admin.html.
   A card links to buy_url when set (a Square checkout link);
   until links exist the Buy button is a placeholder that goes
   nowhere — the store is dressed and ready for wiring. */

(async function buildShop() {
  const grid = document.getElementById("productGrid");
  if (!grid) return;
  let products = [];
  try {
    products = await (await fetch("products.json")).json();
  } catch (e) {
    return;
  }

  const shown = products
    .filter((p) => p.visible)
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "sold" ? 1 : -1));

  const frag = document.createDocumentFragment();
  shown.forEach((p) => {
    const sold = p.status === "sold";
    const card = document.createElement("a");
    card.className = "product-card" + (sold ? " is-sold" : "");
    if (!sold && p.buy_url) {
      card.href = p.buy_url;
      card.target = "_blank";
      card.rel = "noopener";
    }
    // no buy_url yet → inert card; the Buy button is a placeholder

    const dollars = (p.price_cents / 100).toFixed(2);
    card.innerHTML =
      `<span class="card-media">` +
      `<img loading="lazy" src="${p.image}" alt="${p.title} — original painting">` +
      (sold ? `<span class="sold-badge">Sold</span>` : "") +
      `</span>` +
      `<h3>${p.title}</h3>` +
      (p.description ? `<p class="desc">${p.description}</p>` : "") +
      `<p class="price">$${dollars} ${p.currency}</p>` +
      (sold ? "" : `<span class="card-cta">Buy</span>`);
    frag.appendChild(card);
  });
  grid.appendChild(frag);
})();
