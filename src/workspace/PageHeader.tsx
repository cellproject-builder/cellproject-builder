import { createContext, useContext, type ReactNode } from 'react';

/** Shell navigation joins the page's own tools without moving their state. */
export const PageHeaderContext = createContext<{
  navigation: ReactNode;
  breadcrumb: ReactNode;
  status: ReactNode;
} | null>(null);

type PageHeaderProps = {
  title: string;
  titleIcon?: ReactNode;
  description?: string;
  controls?: ReactNode;
  actions?: ReactNode;
};

/** Shared page chrome. Each surface owns the controls, state and actions in its slots. */
export function PageHeader({ title, titleIcon, description, controls, actions }: PageHeaderProps) {
  const shell = useContext(PageHeaderContext);
  return <header className={`ws-page-header ${controls ? 'has-controls' : ''}`}>
    <div className="ws-page-header-row">
      <div className="ws-page-header-leading">
        {shell?.navigation}
        <div className="ws-page-header-location">
          {shell?.breadcrumb && <div className="ws-breadcrumb">{shell.breadcrumb}</div>}
          <h1 title={title}>{titleIcon}{title}</h1>
          {shell?.status}
        </div>
      </div>
      {controls && <div className="ws-page-header-controls">{controls}</div>}
      {actions && <div className="ws-page-header-actions">{actions}</div>}
    </div>
    {description && <p className="ws-page-description">{description}</p>}
  </header>;
}
