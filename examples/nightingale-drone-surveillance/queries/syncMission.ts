// ─────────────────────────────────────────────────────────────
// Query Functions
// ─────────────────────────────────────────────────────────────

function getLatestSynced(missionId, context, cubby) {
  const key = `mission/${missionId}/synced/latest`;
  context.log(`getLatestSync:${key}`);
  const data = cubby.json.get(key);

  if (!data) {
    return { success: true, data: null };
  }

  return { success: true, data: data };
}

async function getAllSynced(missionId, context, cubby) {
  const pattern = `mission/${missionId}/synced/*`;
  const keys = await cubby.json.keys(pattern);
  context.log(`getAllSynced keys: ${JSON.stringify(keys)}`);

  if (!keys || keys.length === 0) {
    return { success: true, data: [] };
  }

  const dataKeys = keys.filter(k => !k.endsWith('/latest'));
  
  if (dataKeys.length === 0) {
    return { success: true, data: [] };
  }

  const allData = await cubby.json.mget(dataKeys);
  
  const dataArray = Object.values(allData)
    .filter(item => item !== null)
    //@ts-ignore
    .sort((a, b) => a.timestamp - b.timestamp);

  return { success: true, data: dataArray };
}

async function getSyncedRange(missionId, startTime, endTime, context, cubby) {
  const pattern = `mission/${missionId}/synced/*`;
  const keys = await cubby.json.keys(pattern);

  if (!keys || keys.length === 0) {
    return { success: true, data: [] };
  }

  const filteredKeys = keys.filter(k => {
    if (k.endsWith('/latest')) return false;
    const ts = parseInt(k.split('/').pop(), 10);
    return ts >= startTime && ts <= endTime;
  });

  if (filteredKeys.length === 0) {
    return { success: true, data: [] };
  }

  const allData = await cubby.json.mget(filteredKeys);
  
  const dataArray = Object.values(allData)
    .filter(item => item !== null)
     //@ts-ignore
    .sort((a, b) => a.timestamp - b.timestamp);

  return { success: true, data: dataArray };
}

async function getSyncedPaginated(missionId, page, pageSize, context, cubby) {
  const pattern = `mission/${missionId}/synced/*`;
  const keys = await cubby.json.keys(pattern);

  if (!keys || keys.length === 0) {
    return { success: true, data: [], totalCount: 0, page, pageSize, hasMore: false };
  }

  const dataKeys = keys
    .filter(k => !k.endsWith('/latest'))
    .sort((a, b) => {
      const tsA = parseInt(a.split('/').pop(), 10);
      const tsB = parseInt(b.split('/').pop(), 10);
      return tsA - tsB;
    });

  const totalCount = dataKeys.length;
  const offset = page * pageSize;

  if (offset >= totalCount) {
    return { success: true, data: [], totalCount, page, pageSize, hasMore: false };
  }

  const slicedKeys = dataKeys.slice(offset, offset + pageSize);
  const slicedData = await cubby.json.mget(slicedKeys);

  const dataArray = Object.values(slicedData)
    .filter(item => item !== null)
    //@ts-ignore
    .sort((a, b) => a.timestamp - b.timestamp);

  context.log(`getSyncedPaginated: page=${page}, pageSize=${pageSize}, returned=${dataArray.length}, total=${totalCount}`);

  return {
    success: true,
    data: dataArray,
    totalCount,
    page,
    pageSize,
    hasMore: offset + pageSize < totalCount
  };
}

async function getSyncedSince(missionId, afterTimestamp, context, cubby) {
  const pattern = `mission/${missionId}/synced/*`;
  const keys = await cubby.json.keys(pattern);

  if (!keys || keys.length === 0) {
    return { success: true, data: [], afterTimestamp };
  }

  const filteredKeys = keys.filter(k => {
    if (k.endsWith('/latest')) return false;
    const ts = parseInt(k.split('/').pop(), 10);
    return ts > afterTimestamp;
  });

  if (filteredKeys.length === 0) {
    return { success: true, data: [], afterTimestamp };
  }

  const newData = await cubby.json.mget(filteredKeys);

  const dataArray = Object.values(newData)
    .filter(item => item !== null)
    //@ts-ignore
    .sort((a, b) => a.timestamp - b.timestamp);

  context.log(`getSyncedSince: afterTimestamp=${afterTimestamp}, returned=${dataArray.length}`);

  return { success: true, data: dataArray, afterTimestamp };
}

async function getLastNSynced(missionId, n, context, cubby) {
  const pattern = `mission/${missionId}/synced/*`;
  const keys = await cubby.json.keys(pattern);

  if (!keys || keys.length === 0) {
    return { success: true, data: [], totalCount: 0 };
  }

  const dataKeys = keys
    .filter(k => !k.endsWith('/latest'))
    .sort((a, b) => {
      const tsA = parseInt(a.split('/').pop(), 10);
      const tsB = parseInt(b.split('/').pop(), 10);
      return tsA - tsB;
    });

  const totalCount = dataKeys.length;
  const lastN = Math.min(Number(n), totalCount);
  const slicedKeys = dataKeys.slice(-lastN);

  const slicedData = await cubby.json.mget(slicedKeys);

  const dataArray = Object.values(slicedData)
    .filter(item => item !== null)
    //@ts-ignore
    .sort((a, b) => a.timestamp - b.timestamp);

  context.log(`getLastNSynced: n=${n}, returned=${dataArray.length}, total=${totalCount}`);

  return { success: true, data: dataArray, totalCount };
}

async function getSyncedMetadata(missionId, context, cubby) {
  const pattern = `mission/${missionId}/synced/*`;
  const keys = await cubby.json.keys(pattern);

  if (!keys || keys.length === 0) {
    return { success: true, data: { totalCount: 0, firstTimestamp: null, lastTimestamp: null } };
  }

  const dataKeys = keys.filter(k => !k.endsWith('/latest'));

  if (dataKeys.length === 0) {
    return { success: true, data: { totalCount: 0, firstTimestamp: null, lastTimestamp: null } };
  }

  const timestamps = dataKeys
    .map(k => parseInt(k.split('/').pop(), 10))
    .sort((a, b) => a - b);

  context.log(`getSyncedMetadata: totalCount=${timestamps.length}, first=${timestamps[0]}, last=${timestamps[timestamps.length - 1]}`);

  return {
    success: true,
    data: {
      totalCount: timestamps.length,
      firstTimestamp: timestamps[0],
      lastTimestamp: timestamps[timestamps.length - 1]
    }
  };
}

async function handle(params: any, context: any): Promise<any> {
   try {
    const cubby = await context.cubby('syncMission');
    const { missionId, mode, startTime, endTime, page, pageSize, afterTimestamp } = params;
    context.log(`Query: mission=${missionId}, mode=${mode || "synced"}`);

    if (!missionId) {
      return { success: false, error: "missionId required" };
    }

    if (mode === "latest") {
      return getLatestSynced(missionId, context, cubby);
    } else if (mode === "range" && startTime && endTime) {
      return getSyncedRange(missionId, startTime, endTime, context, cubby);
    } else if (mode === "paginated") {
      return getSyncedPaginated(missionId, page || 0, pageSize || 100, context, cubby);
    } else if (mode === "since" && afterTimestamp != null) {
      return getSyncedSince(missionId, afterTimestamp, context, cubby);
    } else if (mode === "metadata") {
      return getSyncedMetadata(missionId, context, cubby);
    } else if (mode === "lastN" && params.n != null) {
      return getLastNSynced(missionId, Number(params.n), context, cubby);
    } else {
      return getAllSynced(missionId, context, cubby);
    }
  } catch (error) {
    context.log(`Query failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
