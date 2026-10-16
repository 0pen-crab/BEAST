import { Link } from 'react-router';

interface Crumb {
  label: string;
  to?: string;
}

export function BreadcrumbNav({ items }: { items: Crumb[] }) {
  return (
    <nav className="beast-breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i}>
            {i > 0 && <span className="beast-breadcrumb-sep">/</span>}
            {item.to && !isLast ? (
              <Link to={item.to} className="beast-breadcrumb-item">{item.label}</Link>
            ) : (
              <span className={isLast ? 'beast-breadcrumb-item beast-breadcrumb-item-active' : 'beast-breadcrumb-item'}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
