self.addEventListener('message', function(e) {
  const { text } = e.data || {};
  if (!text) return postMessage({ type: 'error', message: 'No input' });
  try {
    const parsed = JSON.parse(text);
    const isTopArray = Array.isArray(parsed);
    const arr = isTopArray ? parsed : (Array.isArray(parsed?.data) ? parsed.data : (Array.isArray(parsed?.leads) ? parsed.leads : []));
    const meta = {};
    if (!isTopArray && parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.data)) {
        meta.page = parsed.page || parsed.pagination?.page || 1;
        meta.pages = parsed.pages || parsed.pagination?.totalPages || 1;
        meta.total = parsed.total || parsed.pagination?.total || parsed.data.length;
      }
    }
    const chunkSize = 500;
    for (let i = 0; i < arr.length; i += chunkSize) {
      const chunk = arr.slice(i, i + chunkSize);
      postMessage({ type: 'chunk', chunk });
    }
    if (meta && Object.keys(meta).length) postMessage({ type: 'meta', meta });
    postMessage({ type: 'done', total: arr.length });
  } catch (err) {
    postMessage({ type: 'error', message: err?.message || String(err) });
  }
});
