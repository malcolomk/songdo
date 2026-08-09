const url = "https://zblzdqwqxagqnkrojyda.supabase.co/rest/v1/inventory_logs";
const headers = {
  "apikey": "sb_publishable_rV-ZqhhA4pxsIN_9NhPEcg_EoiM_xo1",
  "Authorization": "Bearer sb_publishable_rV-ZqhhA4pxsIN_9NhPEcg_EoiM_xo1",
  "Content-Type": "application/json",
  "Prefer": "return=representation"
};
const body = { type: '입고', artNo: '1234', artName: 'test', qty: 1, date: '2026-08-04', user: 'junkoo' };
fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  .then(res => res.json())
  .then(console.log)
  .catch(console.error);
