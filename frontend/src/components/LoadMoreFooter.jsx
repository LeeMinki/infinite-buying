import React from 'react';

// 페이징 목록 하단의 "더 보기" 영역. 현재 표시 개수/전체 개수를 함께 보여 준다.
export function LoadMoreFooter({ shown, total, hasMore, loading, onLoadMore }) {
  if (!total) return null;
  return (
    <div className="load-more-footer">
      <span className="helper">{shown.toLocaleString('ko-KR')} / {total.toLocaleString('ko-KR')}건</span>
      {hasMore && (
        <button type="button" className="ghost sm" onClick={onLoadMore} disabled={loading}>
          {loading ? '불러오는 중…' : '더 보기'}
        </button>
      )}
    </div>
  );
}
