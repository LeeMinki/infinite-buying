import React, { useEffect, useState } from 'react';
import { searchStocks } from '../api/client.js';

export function StockSearchField({
  stockCode,
  stockName,
  onSelect,
  onClear,
  clearSignal,
  label = '종목 검색',
  helper = '검색 결과를 선택하면 종목코드와 종목명이 자동으로 입력됩니다.'
}) {
  const [query, setQuery] = useState(stockCode && stockName ? `${stockCode} · ${stockName}` : '');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (stockCode && stockName) {
      setQuery(`${stockCode} · ${stockName}`);
    }
  }, [stockCode, stockName]);

  useEffect(() => {
    if (clearSignal === undefined) return;
    setQuery('');
    setResults([]);
    setError('');
  }, [clearSignal]);

  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length < 2 || (stockCode && query === `${stockCode} · ${stockName}`)) {
      setResults([]);
      setError('');
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      setError('');
      try {
        const data = await searchStocks(keyword);
        if (!cancelled) setResults(data?.items || []);
      } catch (err) {
        if (!cancelled) {
          setResults([]);
          setError(err.message);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, stockCode, stockName]);

  function choose(stock) {
    onSelect(stock);
    setQuery(`${stock.stockCode} · ${stock.stockName}`);
    setResults([]);
    setError('');
  }

  function changeQuery(value) {
    setQuery(value);
    if (onClear) onClear();
  }

  const noResults = query.trim().length >= 2 && !searching && results.length === 0 && !stockCode && !error;

  return (
    <label className="stock-search-field">
      <span>{label}</span>
      <div className="stock-search">
        <input
          placeholder="예: 005930 또는 삼성전자"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          autoComplete="off"
        />
        {results.length > 0 && (
          <div className="stock-results" role="listbox" aria-label="종목 검색 결과">
            {results.map((stock) => (
              <button
                type="button"
                role="option"
                key={`${stock.stockCode}-${stock.stockName}`}
                onClick={() => choose(stock)}
              >
                <strong>{stock.stockCode}</strong>
                <span>{stock.stockName}</span>
                <em>{stock.source}</em>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="helper">
        {searching ? '종목 정보를 조회하는 중입니다.' : helper}
      </p>
      {error && <p className="form-error">{error}</p>}
      {noResults && <p className="helper">검색 결과가 없습니다. 종목코드나 종목명을 조금 더 정확히 입력해 주세요.</p>}
      {stockCode && (
        <p className="selected-stock">
          선택됨: <b>{stockCode}</b>{stockName ? ` · ${stockName}` : ''}
        </p>
      )}
    </label>
  );
}
