const supabaseUrl = "https://zblzdqwqxagqnkrojyda.supabase.co";
const supabaseKey = "sb_publishable_rV-ZqhhA4pxsIN_9NhPEcg_EoiM_xo1";
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from('inventory_logs').insert([{ type: '입고', artno: '1234', artname: 'test', qty: 1, date: '2026-08-04', user: 'junkoo', timestamp: '2026-08-04T12:00:00Z' }]);
  console.log('Error:', error);
}
test();
