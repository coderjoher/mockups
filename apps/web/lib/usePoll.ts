'use client';
import { useEffect, useRef } from 'react';

/** Calls fn every `ms` while `active` is true (REST + polling, per the PRD architecture). */
export function usePoll(fn: () => void | Promise<void>, ms: number, active: boolean) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void saved.current(), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}
