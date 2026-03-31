import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="beast-not-found">
      <p className="beast-not-found-code">404</p>
      <p className="beast-not-found-text">{t('common.pageNotFound')}</p>
      <Link
        to="/"
        className="beast-btn beast-btn-outline beast-mt-lg"
      >
        {t('common.backToDashboard')}
      </Link>
    </div>
  );
}
