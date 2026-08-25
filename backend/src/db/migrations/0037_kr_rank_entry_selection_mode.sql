-- strict 후보와 제한 core fallback 후보의 provenance를 보존한다.
-- 다음 tick 재확인에서 최초 선택에 사용한 필터보다 느슨한 필터로 바뀌지 않게 한다.
ALTER TABLE kr_rank_entries
  ADD COLUMN selection_mode TEXT NOT NULL DEFAULT 'STRICT'
  CHECK (selection_mode IN ('STRICT', 'CORE_FALLBACK'));
