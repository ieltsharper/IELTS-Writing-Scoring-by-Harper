// Apps Script entry points. Filled in by later build steps.
export function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, service: 'ielts-writing' }),
  ).setMimeType(ContentService.MimeType.JSON);
}
export function doPost() {
  return doGet();
}
export function setup() {}
export function installTriggers() {}
export function dailyJob() {}
export function hourlyJob() {}
