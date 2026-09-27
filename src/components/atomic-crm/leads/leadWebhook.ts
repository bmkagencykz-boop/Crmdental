/**
 * Lead webhook (website, Tilda, 2GIS): the address given to the clinic, the
 * ready-to-paste form for a website, and the test request of the settings.
 */

/** Base URL of the edge functions, as seen from the clinic's website */
export const functionsBaseUrl = (
  supabaseUrl: string,
  override?: string | null,
) => override || `${supabaseUrl.replace(/\/+$/, "")}/functions/v1`;

export const leadWebhookUrl = (baseUrl: string, token: string) =>
  `${baseUrl}/leads_webhook?token=${encodeURIComponent(token)}`;

/** What «Send a test request» posts, like a website form would */
export const TEST_LEAD = {
  name: "Тестовая заявка",
  phone: "+7 700 000 00 00",
  source: "website",
  comment: "Проверка подключения из настроек CRM",
} as const;

export type SnippetTexts = {
  name: string;
  phone: string;
  comment: string;
  submit: string;
  thanks: string;
  error: string;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * A plain HTML form posting to the webhook with fetch(): name, phone and a
 * comment, plus the UTM tags of the page address.
 */
export const leadFormSnippet = (url: string, texts: SnippetTexts) =>
  `<form id="dentalcrm-form">
  <input name="name" placeholder="${escapeHtml(texts.name)}" required>
  <input name="phone" type="tel" placeholder="${escapeHtml(texts.phone)}" required>
  <textarea name="comment" placeholder="${escapeHtml(texts.comment)}"></textarea>
  <button type="submit">${escapeHtml(texts.submit)}</button>
</form>
<script>
document.getElementById("dentalcrm-form").addEventListener("submit", function (event) {
  event.preventDefault();
  var form = event.target;
  var data = Object.fromEntries(new FormData(form));
  var params = new URLSearchParams(window.location.search);
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (key) {
    if (params.get(key)) data[key] = params.get(key);
  });
  data.source = data.source || "website";
  fetch(${JSON.stringify(url)}, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).then(function (response) {
    if (!response.ok) throw new Error(response.status);
    form.innerHTML = ${JSON.stringify(`<p>${escapeHtml(texts.thanks)}</p>`)};
  }).catch(function () {
    alert(${JSON.stringify(texts.error)});
  });
});
</script>`;

/** Note of the deal, same text as public.ingest_lead (demo) */
export const leadNoteText = ({
  repeat,
  sourceName,
  name,
  phone,
  service,
  comment,
}: {
  repeat: boolean;
  sourceName: string;
  name?: string | null;
  phone: string;
  service?: string | null;
  comment?: string | null;
}) =>
  [
    `${repeat ? "Повторная заявка" : "Заявка"} (${sourceName})`,
    name ? `Имя: ${name}` : null,
    `Телефон: ${phone}`,
    service ? `Услуга: ${service}` : null,
    comment ? `Комментарий: ${comment}` : null,
  ]
    .filter(Boolean)
    .join("\n");
