import { useState, useSyncExternalStore } from 'react';
import { useLocaleStore } from '@/i18n';
import { applyPwaUpdate, installController, isIos } from './install';
import './pwa.css';

export function InstallApp() {
  const en = useLocaleStore(s => s.locale === 'en');
  const state = useSyncExternalStore(installController.subscribe, installController.getSnapshot);
  const [instructions, setInstructions] = useState(false);
  const ios = isIos(navigator.userAgent, navigator.maxTouchPoints);
  return <section className="pwa-settings" aria-label={en ? 'Install application' : 'Instalar aplicativo'}>
    <h3>{en ? 'On your device' : 'No seu dispositivo'}</h3>
    <p>{en ? 'Open your workspace in its own window. Projects stay in this browser; AI and web research require a connection.' : 'Abra seu espaço em uma janela própria. Os projetos ficam neste navegador; IA e pesquisas na web precisam de conexão.'}</p>
    {state.installed ? <span className="pwa-state">{en ? 'Application installed' : 'Aplicativo instalado'}</span> : state.available ? <button type="button" className="ws-button" onClick={() => void installController.install()}>{en ? 'Install app' : 'Instalar aplicativo'}</button> : <button type="button" className="ws-button" disabled={state.prompting} onClick={() => setInstructions(value => !value)} aria-expanded={instructions}>{state.prompting ? (en ? 'Opening installer…' : 'Abrindo instalação…') : (en ? 'How to install' : 'Como instalar')}</button>}
    {instructions && !state.installed && <p className="pwa-instructions">{ios ? (en ? 'In Safari, open Share, choose Add to Home Screen, then Add. If this page is inside another app, open it in Safari first.' : 'No Safari, abra Compartilhar, escolha Adicionar à Tela de Início e toque em Adicionar. Se esta página estiver dentro de outro aplicativo, abra-a no Safari primeiro.') : (en ? 'Open your browser menu and look for Install app or Add to Home Screen. Availability depends on the browser and a secure HTTPS address (localhost also works).' : 'Abra o menu do navegador e procure Instalar aplicativo ou Adicionar à tela inicial. A opção depende do navegador e de um endereço HTTPS seguro (localhost também funciona).')}</p>}
    {state.error && <p role="status">{en ? 'The installation did not open. Try the browser menu.' : 'A instalação não abriu. Tente pelo menu do navegador.'}</p>}
    {state.offline && <p role="status">{en ? 'You are offline. AI and image searches will be available when the connection returns.' : 'Você está sem conexão. IA e buscas de imagens voltam quando a conexão retornar.'}</p>}
    {state.updateReady && <div className="pwa-update"><p>{en ? 'An update is ready. Finish your current work before restarting this window.' : 'Há uma atualização pronta. Termine seu trabalho antes de reiniciar esta janela.'}</p><button type="button" className="ws-button" onClick={applyPwaUpdate}>{en ? 'Update and restart' : 'Atualizar e reiniciar'}</button></div>}
  </section>;
}
