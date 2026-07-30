'use strict';

(function exposePreferenceDragSort(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorPreferenceDragSort = api;
})(typeof window !== 'undefined' ? window : null, function createPreferenceDragSortApi() {
  function normalizeId(value) {
    return String(value || '').trim().toLowerCase();
  }

  function rowId(row) {
    return normalizeId(row?.id);
  }

  function midpoint(row) {
    const top = Number(row?.top);
    const bottom = Number(row?.bottom);
    if (Number.isFinite(top) && Number.isFinite(bottom)) return top + (bottom - top) / 2;
    const height = Number(row?.height);
    return Number.isFinite(top) && Number.isFinite(height) ? top + height / 2 : 0;
  }

  function dropIndexFromClientY(rows, draggedId, clientY) {
    const dragged = normalizeId(draggedId);
    const y = Number(clientY);
    const targets = (rows || []).filter((row) => {
      const id = rowId(row);
      return id && id !== dragged;
    });
    if (!Number.isFinite(y)) return targets.length;
    for (const [index, row] of targets.entries()) {
      if (y < midpoint(row)) return index;
    }
    return targets.length;
  }

  function reorderItems(items, draggedId, targetIndex) {
    const dragged = normalizeId(draggedId);
    const order = (items || []).map(normalizeId).filter(Boolean);
    const from = order.indexOf(dragged);
    if (from < 0) return order;
    const to = Math.max(0, Math.min(order.length - 1, Number(targetIndex) || 0));
    if (from === to) return order;
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    return order;
  }

  function reorderItemsFromClientY(items, rows, draggedId, clientY) {
    return reorderItems(items, draggedId, dropIndexFromClientY(rows, draggedId, clientY));
  }

  // Live drags only see the currently-visible rows. Fold that partial order back
  // into the full order so hidden entries keep their positions: walk the full
  // order and replace each visible slot with the next id from the dragged order.
  function mergeVisibleOrderIntoFull(fullOrder, visibleOrder) {
    const full = (fullOrder || []).map(normalizeId).filter(Boolean);
    const fullSet = new Set(full);
    const queue = (visibleOrder || []).map(normalizeId).filter((id) => id && fullSet.has(id));
    const visibleSet = new Set(queue);
    const merged = [];
    for (const id of full) {
      merged.push(visibleSet.has(id) && queue.length > 0 ? queue.shift() : id);
    }
    return merged;
  }

  return { dropIndexFromClientY, mergeVisibleOrderIntoFull, reorderItems, reorderItemsFromClientY };
});
