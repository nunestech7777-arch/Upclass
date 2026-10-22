import React, { useEffect, useRef } from 'react';
import symbol from '../../assets/brand/upclass/symbol.png';
import './LoginIntro.css';

/**
 * Assinatura de entrada do login: símbolo oficial com uma única rotação e anel de energia.
 * Puramente visual (não indica carregamento de dados). Chama `onDone` uma vez, ao terminar
 * o fade da camada; um tempo-limite garante a liberação mesmo se o navegador não emitir o evento.
 */
export function LoginIntro({ onDone }: { onDone: () => void }) {
  const finished = useRef(false);
  const finish = useRef(onDone);
  finish.current = onDone;

  const done = () => {
    if (finished.current) return;
    finished.current = true;
    finish.current();
  };

  useEffect(() => {
    const t = window.setTimeout(done, 2200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="login-intro"
      aria-hidden="true"
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) done();
      }}
    >
      <div className="login-intro-mark">
        <span className="login-intro-ring" />
        <img src={symbol} alt="" className="login-intro-symbol" draggable={false} />
      </div>
    </div>
  );
}
