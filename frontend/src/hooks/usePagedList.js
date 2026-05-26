import { useCallback, useState } from 'react';

export const PAGE_SIZE = 50;

// 판단 로그·주문 이력·진입/매매 사이클처럼 길어지는 목록의 페이징 상태를 다룬다.
// 백엔드는 { items, total, limit, offset }를 돌려주며, "더 보기"는 limit를 키워 다시 조회한다.
// 매번 처음부터 다시 받아 교체하므로 append 병합 버그가 없고, 새로고침 시 자연히 최신 정렬을 유지한다.
export function usePagedList(fetcher, pageSize = PAGE_SIZE) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(pageSize);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (id, nextLimit = pageSize) => {
      const res = await fetcher(id, { limit: nextLimit });
      setItems(Array.isArray(res?.items) ? res.items : []);
      setTotal(Number(res?.total || 0));
      setLimit(nextLimit);
      return res;
    },
    [fetcher, pageSize]
  );

  const loadMore = useCallback(
    async (id) => {
      if (loading) return;
      setLoading(true);
      try {
        await load(id, limit + pageSize);
      } finally {
        setLoading(false);
      }
    },
    [load, loading, limit, pageSize]
  );

  const reset = useCallback(() => {
    setItems([]);
    setTotal(0);
    setLimit(pageSize);
  }, [pageSize]);

  return { items, total, limit, loading, load, loadMore, reset, hasMore: items.length < total };
}
