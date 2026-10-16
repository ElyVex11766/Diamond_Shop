"use strict";

const API_URL = "/api/items";
const state = { items: [], quantities: new Map() };
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

/* لینک اختصاصی پرداخت: /pay/توکن */
async function loadPaymentPage() {
  const match = window.location.pathname.match(/^\/pay\/([a-f0-9]{64})\/?$/i);
  if (!match) return false;

  document.title = "پرداخت سفارش | Diamond Shop";

  document.body.innerHTML = `
    <main class="payment-wrap" dir="rtl">
      <header class="brand">
        💎 DIAMOND <span>SHOP</span>
        <small>SECURE ORDER DETAILS</small>
      </header>

      <section class="section payment-order">
        <h1>💳 اطلاعات سفارش شما</h1>
        <p id="payment-loading" class="section-description">
          در حال دریافت اطلاعات سفارش...
        </p>
        <div id="payment-content"></div>
      </section>

      <footer>
        <span>DIAMOND SHOP</span><br>
        پرداخت و پشتیبانی سفارش در دیسکورد
      </footer>
    </main>

    <style>
      body {
        margin: 0;
        min-height: 100vh;
        padding: 24px 14px;
        background: radial-gradient(ellipse at top, #10283b 0%, transparent 48%), #080b12;
        color: #f4f8ff;
        font-family: Tahoma, Arial, sans-serif;
        line-height: 1.9;
      }

      .payment-wrap {
        width: 100%;
        max-width: 720px;
        margin: auto;
      }

      .brand {
        text-align: center;
        font-size: 27px;
        font-weight: 900;
      }

      .brand span,
      h1 span {
        color: #00aaff;
      }

      .brand small {
        display: block;
        color: #51d8ff;
        font-size: 11px;
        letter-spacing: 3px;
      }

      .section {
        margin-top: 24px;
        padding: 22px;
        border: 1px solid #183d59;
        border-radius: 18px;
        background: linear-gradient(145deg, #101b2b, #0a101a);
        box-shadow: 0 10px 35px #0002;
      }

      h1 {
        font-size: 24px;
        text-align: center;
      }

      .section-description {
        color: #a9b8ca;
        font-size: 13px;
      }

      .order-row {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        padding: 12px 4px;
        border-bottom: 1px solid #183d59;
      }

      .order-row span {
        color: #a9b8ca;
      }

      .order-row strong {
        text-align: left;
        overflow-wrap: anywhere;
      }

      .expiry-timer {
        margin-top: 16px;
        padding: 12px;
        border: 1px solid #183d59;
        border-radius: 12px;
        background: #0b1725;
        color: #a9b8ca;
        text-align: center;
        font-size: 13px;
      }

      .expiry-timer strong {
        display: block;
        color: #51d8ff;
        font: 700 25px Arial, sans-serif;
        direction: ltr;
      }

      .expiry-timer.expired {
        border-color: #8a3544;
        color: #ff9aa8;
      }

      .expiry-timer.expired strong,
      .expired-message {
        color: #ff8292;
      }

      .expired-message {
        text-align: center;
        padding: 14px;
        border: 1px solid #71313d;
        border-radius: 12px;
        background: #241018;
      }

      .total {
        margin-top: 16px;
        padding: 16px;
        border: 1px solid #07568a;
        border-radius: 12px;
        background: #081725;
        color: #51d8ff;
        font-size: 20px;
        font-weight: bold;
        text-align: center;
      }

      .bank-card {
        margin-top: 20px;
        padding: 20px;
        border: 1px solid #70d8ff;
        border-radius: 16px;
        background: linear-gradient(125deg, #0c3767, #0755a1 48%, #0a244b);
      }

      .bank-name {
        font-weight: bold;
      }

      .bank-name small {
        display: block;
        font-size: 11px;
      }

      .card-number {
        margin-top: 16px;
        text-align: center;
        direction: ltr;
        font: bold 22px Arial;
        letter-spacing: 1px;
      }

      .copy-button,
      .ticket {
        display: block;
        width: 100%;
        box-sizing: border-box;
        margin-top: 14px;
        padding: 13px;
        border: 1px solid #00aaff;
        border-radius: 11px;
        background: #06233a;
        color: #51d8ff;
        text-align: center;
        font-family: inherit;
        font-size: 14px;
        font-weight: bold;
        text-decoration: none;
        cursor: pointer;
      }

      .ticket {
        border: 0;
        background: linear-gradient(100deg, #008be8, #00baff);
        color: #06111b;
      }

      .notice {
        margin-top: 16px;
        padding: 12px;
        border: 1px solid #183d59;
        border-radius: 10px;
        color: #51d8ff;
        font-size: 13px;
      }

      .error-message {
        color: #ff8292;
        text-align: center;
      }

      footer {
        margin-top: 30px;
        color: #62748b;
        text-align: center;
        font-size: 12px;
      }

      footer span {
        color: #00aaff;
        letter-spacing: 2px;
      }
    </style>
  `;

  const loading = document.querySelector("#payment-loading");
  const content = document.querySelector("#payment-content");

  try {
    const response = await fetch(`/api/payment-links/${match[1]}`, {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok || !data.order) {
      throw new Error(
        response.status === 410
          ? "این لینک پرداخت منقضی شده یا قبلاً استفاده شده است."
          : response.status === 404
            ? "این لینک پرداخت معتبر نیست."
            : (data.error || "دریافت اطلاعات سفارش ناموفق بود.")
      );
    }

    const order = data.order;
    const expiryTime = new Date(order.expires_at).getTime();

    if (!Number.isFinite(expiryTime)) {
      throw new Error("زمان انقضای لینک از سرور دریافت نشد.");
    }

    loading.textContent = "اطلاعات سفارش ثبت‌شده برای این لینک:";

    content.innerHTML = `
      <div class="order-row">
        <span>شماره سفارش</span>
        <strong>${escapeHTML(order.order_id || order.id)}</strong>
      </div>

      <div class="order-row">
        <span>نام خریدار در Discord</span>
        <strong>${escapeHTML(order.discord_username)}</strong>
      </div>

      <div class="order-row">
        <span>محصول</span>
        <strong>${escapeHTML(order.item_name)}</strong>
      </div>

      <div class="order-row">
        <span>تعداد</span>
        <strong>${Number(order.quantity || 0).toLocaleString("fa-IR")}</strong>
      </div>

      <div class="order-row">
        <span>قیمت هر عدد</span>
        <strong>${formatToman(order.unit_price_toman)}</strong>
      </div>

      <div
        class="expiry-timer"
        id="payment-expiry-timer"
        role="timer"
        aria-live="off"
      >
        زمان باقی‌مانده برای پرداخت
        <strong id="payment-countdown" dir="ltr">30:00</strong>
      </div>

      <div class="total" id="payment-total">
        مبلغ نهایی: ${formatToman(order.amount_toman)}
      </div>

      <div class="bank-card">
        <div class="bank-name">
          بانک صادرات ایران
          <small>BANK SADERAT IRAN</small>
        </div>

        <div class="card-number" dir="ltr">
          6037 - 6976 - 2938 - 7157
        </div>
      </div>

      <div class="order-row">
        <span>نام صاحب کارت</span>
        <strong>جعفری</strong>
      </div>

      <button
        class="copy-button"
        id="copy-payment-card"
        type="button"
      >
        کپی شماره کارت
      </button>

      <p
        id="copy-payment-status"
        class="section-description"
        role="status"
      ></p>

      <a
  class="ticket"
  href="${escapeHTML(order.ticket_url || "#")}"
  target="_blank"
  rel="noopener noreferrer"
>
  🎮 ارسال رسید در تیکت دیسکورد
</a>

      <div class="notice">
        ⚠️ فقط مبلغ نمایش‌داده‌شده برای همین سفارش را واریز کن.
        پس از پرداخت، رسید را در تیکت دیسکورد ارسال کن.
        این صفحه پرداخت را به‌صورت خودکار تأیید نمی‌کند.
      </div>

      <p class="section-description">
        اعتبار لینک تا:
        ${escapeHTML(new Date(expiryTime).toLocaleString("fa-IR"))}
      </p>
    `;

    const timerBox = document.querySelector("#payment-expiry-timer");
    const countdown = document.querySelector("#payment-countdown");
    const totalBox = document.querySelector("#payment-total");
    const bankCard = content.querySelector(".bank-card");
    const copyButton = document.querySelector("#copy-payment-card");
    const copyStatus = document.querySelector("#copy-payment-status");

    let timerInterval = null;
    let expired = false;

    function expirePaymentLink() {
      if (expired) return;
      expired = true;

      if (timerInterval !== null) {
        window.clearInterval(timerInterval);
        timerInterval = null;
      }

      timerBox.classList.add("expired");
      timerBox.innerHTML =
        'زمان پرداخت تمام شد<strong dir="ltr">00:00</strong>';

      if (totalBox) totalBox.remove();
      if (bankCard) bankCard.remove();
      if (copyButton) copyButton.remove();
      if (copyStatus) copyStatus.remove();

      const notice = content.querySelector(".notice");
      if (notice) notice.remove();

      const expiredMessage = document.createElement("p");
      expiredMessage.className = "expired-message";
      expiredMessage.textContent =
        "لینک پرداخت منقضی شده است. برای دریافت لینک جدید، از طریق تیکت دیسکورد با پشتیبانی تماس بگیر.";

      content.appendChild(expiredMessage);
    }

    function updatePaymentCountdown() {
      const remaining = Math.max(
        0,
        Math.ceil((expiryTime - Date.now()) / 1000)
      );

      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;

      if (countdown) {
        countdown.textContent =
          `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      }

      if (remaining <= 0) {
        expirePaymentLink();
      }
    }

    updatePaymentCountdown();

    if (Date.now() < expiryTime) {
      timerInterval = window.setInterval(
        updatePaymentCountdown,
        1000
      );
    }

    if (copyButton) {
      copyButton.addEventListener("click", async () => {
        if (Date.now() >= expiryTime) {
          expirePaymentLink();
          return;
        }

        const status = document.querySelector("#copy-payment-status");

        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText("6037697629387157");
          } else {
            const field = document.createElement("textarea");
            field.value = "6037697629387157";
            field.style.position = "fixed";
            field.style.opacity = "0";

            document.body.appendChild(field);
            field.select();

            const copied = document.execCommand("copy");
            field.remove();

            if (!copied) throw new Error("copy failed");
          }

          if (status) status.textContent = "شماره کارت کپی شد ✓";
        } catch {
          if (status) {
            status.textContent =
              "کپی نشد؛ شماره کارت را دستی انتخاب کن.";
          }
        }
      });
    }
  } catch (error) {
    loading.textContent = "";

    content.innerHTML = `
      <p class="error-message">${escapeHTML(error.message)}</p>
      <p class="section-description">
        اگر فکر می‌کنی لینک باید معتبر باشد، از پشتیبانی دیسکورد پیگیری کن.
      </p>
    `;
  }

  return true;
}

function getItemPrice(item) {
  return Number(
    item.price_toman ?? item.price ?? item.amount_toman ?? 0
  );
}

function getItemName(item) {
  return item.name ?? item.title ?? item.item_name ?? "محصول";
}

function getItemId(item, index) {
  return String(item.id ?? item.slug ?? index);
}

function isAvailable(item) {
  return (
    item.available !== false &&
    item.in_stock !== false &&
    item.stock !== 0 &&
    item.enabled !== false
  );
}

function updateTotal() {
  let total = 0;

  state.items.forEach((item, index) => {
    total += getItemPrice(item) *
      (state.quantities.get(getItemId(item, index)) || 0);
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

  if (!container) return;

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

        <p class="product-price">
          ${formatToman(price)}
        </p>

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
      headers: { Accept: "application/json" },
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

    if (
      Number.isFinite(stock) &&
      stock > 0 &&
      current >= stock
    ) {
      return;
    }

    state.quantities.set(id, current + 1);
  }

  if (action === "decrease") {
    state.quantities.set(id, Math.max(0, current - 1));
  }

  renderItems();
});

document.addEventListener("DOMContentLoaded", async () => {
  const isPaymentPage = await loadPaymentPage();

  if (!isPaymentPage) {
    loadItems();
  }
});
