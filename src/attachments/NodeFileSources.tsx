import { useWorkspaceStore } from '@/workspace/store';
import { useLocaleStore } from '@/i18n';
export function NodeFileSources({ ids }: { ids?: string[] }) {
  const english = useLocaleStore(s => s.locale) === 'en';
  const projectId = useWorkspaceStore(s => s.activeProjectId);
  const sources = useWorkspaceStore(s => projectId ? s.projects[projectId]?.attachments : undefined) ?? [];
  if (!ids?.length) return null;
  return <div className="plan-attachment-list mt-2">{ids.map(id => {
    const file = sources.find(file => file.id === id);
    return file ? <details className="plan-attachment-chip" key={id}><summary>{file.name}</summary><div className="plan-attachment-preview"><small>{english ? 'Source supporting this part · not experimental evidence' : 'Fonte usada nesta parte · não é evidência de ensaio'}</small><pre>{file.text.slice(0, 8000)}</pre></div></details> : <small key={id}>{english ? 'Source removed from the project' : 'Fonte removida do projeto'}</small>;
  })}</div>;
}
