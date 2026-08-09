window.setSingleLocation = async function(artNo) {
  let masterItem = masterCatalog.find(m => m.artNo === artNo);
  const currentLoc = masterItem ? masterItem.location : "";
  
  const newLoc = prompt(`새로운 창고 구역을 입력하세요 (현재: ${currentLoc || '미지정'})`);
  if (newLoc === null) return; // User cancelled
  
  const locStr = newLoc.trim();
  
  if (masterItem) {
    masterItem.location = locStr;
  } else {
    masterItem = { artNo: artNo, artName: "알 수 없음", location: locStr, hfb: "기본 HFB" };
    masterCatalog.push(masterItem);
  }
  
  saveMasterCatalog(); // Save locally
  
  // Sync to Supabase
  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    try {
      const dbPayload = {
        artno: masterItem.artNo,
        artname: masterItem.artName,
        location: masterItem.location,
        hfb: masterItem.hfb || "기본 HFB"
      };
      
      let hasError = false;
      let lastErrorMsg = "";
      
      if (masterItem.id) {
        const { error } = await supabaseClient.from("master_catalog").update(dbPayload).eq("id", masterItem.id);
        if (error) { hasError = true; lastErrorMsg = error.message; }
      } else {
        const { data: existing, error: selErr } = await supabaseClient.from("master_catalog").select("id").eq("artno", masterItem.artNo).maybeSingle();
        if (existing) {
          masterItem.id = existing.id;
          const { error: updErr } = await supabaseClient.from("master_catalog").update(dbPayload).eq("id", existing.id);
          if (updErr) { hasError = true; lastErrorMsg = updErr.message; }
        } else {
          const { data: inserted, error: insErr } = await supabaseClient.from("master_catalog").insert([dbPayload]).select();
          if (insErr) { hasError = true; lastErrorMsg = insErr.message; }
          else if (inserted && inserted.length > 0) masterItem.id = inserted[0].id;
        }
      }
      
      if (hasError) {
        console.error("Supabase single location update error:", lastErrorMsg);
        showToast("서버 동기화 실패: " + lastErrorMsg, "danger");
      }
    } catch (err) {
      console.error("Supabase single location exception:", err);
      showToast("서버 동기화 오류: " + err.message, "danger");
    }
  }
  
  showToast(`해당 품목의 위치가 [${locStr}] (으)로 변경되었습니다.`, "success");
  playSuccessFeedback();
  renderStockLookup();
};
