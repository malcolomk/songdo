  }
}

function handleRealtimeMasterCatalog(payload) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  
  if (eventType === 'INSERT' || eventType === 'UPDATE') {
    const idx = masterCatalog.findIndex(item => item.id === newRecord.id || item.artNo === (newRecord.artno || newRecord.artNo));
    const mapped = {
      hfb: newRecord.hfb || "",
      artNo: newRecord.artno || newRecord.artNo || "",
      artName: newRecord.artname || newRecord.artName || "",
      location: newRecord.location || "미지정",
      id: newRecord.id
    };
    
    if (idx !== -1) {
      masterCatalog[idx] = { ...masterCatalog[idx], ...mapped };
    } else {
      masterCatalog.push(mapped);
    }
    rebuildMasterCatalogMap();
  } else if (eventType === 'DELETE') {
    masterCatalog = masterCatalog.filter(item => item.id !== oldRecord.id);
    rebuildMasterCatalogMap();
  }
  
  try {
    if (typeof renderStockLookup === 'function') renderStockLookup();
  } catch (e) {}
}
