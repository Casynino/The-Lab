import { useRef } from 'react';
import { makeOnce } from './once.js';

// One guard per component, kept across renders. See once.js.
export function useOnce() {
  const ref = useRef(null);
  if (!ref.current) ref.current = makeOnce();
  return ref.current;
}

export default useOnce;
