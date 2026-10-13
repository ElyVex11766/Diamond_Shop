
"use strict";

const API_URL = "/api/items";

const state = {
  items: [],
  quantities: new Map()
};

const $ = (selector) => document.querySelector(selector);

function formatToman(value) {
  return `${Number(value || 0).toLocaleString("fa-IR")} تومان`;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function getItemPrice(item) {
  return Number(
    item.price_toman ??
    item.price ??
    item.amount_toman ??
    0
  );
}

function getItemName(item) {
  return item.name ?? item.title ?? item.item_name ?? "محصول";
}

function getItemId(item, index) {
  return String(item.id ?? item.slug ?? index);
}

function isAvailable(item) {
  return item.available !== false &&
    item.in_stock !== false &&
    item.stock !== 0 &&
    item.enabled !== false;
}

function updateTotal() {
  let total = 0;

  state.items.forEach((item, index) => {
    const id = getItemId(item, index);
    const quantity = state.quantities.get(id) || 0;
    total += getItemPrice(item) * quantity;
  });

  const totalElement = $("#cart-total");
  if (totalElement) {
    totalElement.textContent = formatToman(total);
  }

  const countElement = $("#cart-count");
  if (countElement) {
    let count = 0;
    state.quantities.forEach((quantity) => {
      count += quantity;
    });
    countElement.textContent = count.toLocaleString("fa-IR");
  }
}

function renderItems() {
  const container =
    $("#items-list") ||
    $("#products-list") ||
    $("#products");

  if (!container) {
    console.error(
      "محل نمایش محصولات پیدا نشد. باید HTML با app.js هماهنگ شود."
    );
    return;
  }

  if (!state.items.length) {
    container.innerHTML =
      '<p class="empty-state">فعلاً محصولی برای نمایش وجود ندارد.</p>';
    updateTotal();
    return;
  }

  container.innerHTML = state.items.map((item, index) => {
    const id = getItemId(item, index);
    const name = getItemName(item);
    const price = getItemPrice(item);
    const available = isAvailable(item);
    const quantity = state.quantities.get(id) || 0;

    return `
      <article class="product-card">
        <h3>${escapeHTML(name)}</h3>
        <p class="product-price">${formatToman(price)}</p>

        ${
          available
            ? `
              <div class="quantity-controls">
                <button
                  type="button"
                  data-action="increase"
                  data-id="${escapeHTML(id)}"
                  aria-label="افزایش تعداد"
                >+</button>

                <span>${quantity.toLocaleString("fa-IR")}</span>

                <button
                  type="button"
                  data-action="decrease"
                  data-id="${escapeHTML(id)}"
                  aria-label="کاهش تعداد"
                  ${quantity <= 0 ? "disabled" : ""}
                >−</button>
              </div>
            `
            : '<p class="out-of-stock">ناموجود</p>'
        }
      </article>
    `;
  }).join("");

  updateTotal();
}

async function loadItems() {
  const container =
    $("#items-list") ||
    $("#products-list") ||
    $("#products");

  try {
    if (container) {
      container.setAttribute("aria-busy", "true");
    }

    const response = await fetch(API_URL, {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`خطای دریافت محصولات: ${response.status}`);
    }

    const data = await response.json();

    state.items = Array.isArray(data)
      ? data
      : Array.isArray(data.items)
        ? data.items
        : [];

    renderItems();
  } catch (error) {
    console.error(error);

    if (container) {
      container.innerHTML =
        '<p class="error-message">دریافت محصولات ناموفق بود. لطفاً دوباره تلاش کن.</p>';
    }
  } finally {
    if (container) {
      container.removeAttribute("aria-busy");
    }
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  const index = state.items.findIndex(
    (item, i) => getItemId(item, i) === id
  );

  if (index < 0) return;

  const item = state.items[index];
  if (!isAvailable(item)) return;

  const current = state.quantities.get(id) || 0;

  if (action === "increase") {
    const stock = Number(item.stock);

    if (Number.isFinite(stock) && stock > 0 && current >= stock) {
      return;
    }

    state.quantities.set(id, current + 1);
  }

  if (action === "decrease") {
    state.quantities.set(id, Math.max(0, current - 1));
  }

  renderItems();
});

document.addEventListener("DOMContentLoaded", loadItems);
