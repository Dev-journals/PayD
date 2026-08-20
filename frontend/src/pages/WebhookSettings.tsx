import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Webhook, Plus, Trash2, Loader2 } from 'lucide-react';
import {
  fetchWebhookSubscriptions,
  createWebhookSubscription,
  deleteWebhookSubscription,
  type WebhookSubscription,
} from '../services/webhookApi.js';

const AVAILABLE_EVENTS = [
  'payment.completed',
  'payment.failed',
  'payroll.processed',
  'employee.added',
  'employee.removed',
];

export default function WebhookSettings() {
  const { t } = useTranslation();

  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const loadSubscriptions = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await fetchWebhookSubscriptions();
        setSubscriptions(data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : t('webhooks.errors.loadFailed'));
      } finally {
        setIsLoading(false);
      }
    };

    void loadSubscriptions();
  }, [t]);

  const toggleEvent = (eventName: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventName) ? prev.filter((item) => item !== eventName) : [...prev, eventName]
    );
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!url.trim()) {
      setFormError(t('webhooks.errors.urlRequired'));
      return;
    }
    if (secret.trim().length < 16) {
      setFormError(t('webhooks.errors.secretTooShort'));
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createWebhookSubscription({
        url: url.trim(),
        secret: secret.trim(),
        events: selectedEvents.length > 0 ? selectedEvents : ['*'],
      });
      setSubscriptions((prev) => [...prev, created]);
      setUrl('');
      setSecret('');
      setSelectedEvents([]);
    } catch (submitError) {
      setFormError(
        submitError instanceof Error ? submitError.message : t('webhooks.errors.createFailed')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await deleteWebhookSubscription(id);
      setSubscriptions((prev) => prev.filter((subscription) => subscription.id !== id));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : t('webhooks.errors.deleteFailed')
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-12 max-w-3xl mx-auto w-full">
      <div className="w-full mb-12 flex items-end justify-between border-b border-hi pb-8">
        <div>
          <h1 className="text-4xl font-black mb-2 tracking-tight">{t('webhooks.title')}</h1>
          <p className="text-sm text-muted mt-2">{t('webhooks.subtitle')}</p>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          void handleCreate(event);
        }}
        className="w-full card glass noise p-8 mb-8"
      >
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5" />
          {t('webhooks.createTitle')}
        </h2>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="block text-xs font-bold uppercase tracking-widest text-muted">
              {t('webhooks.urlLabel')}
            </label>
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t('webhooks.urlPlaceholder')}
              className="w-full bg-black/20 border border-hi rounded-xl p-4 text-text outline-none focus:border-accent/50 focus:bg-accent/5 transition-all"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="block text-xs font-bold uppercase tracking-widest text-muted">
              {t('webhooks.secretLabel')}
            </label>
            <p className="text-xs text-muted">{t('webhooks.secretDescription')}</p>
            <input
              type="text"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={t('webhooks.secretPlaceholder')}
              className="w-full bg-black/20 border border-hi rounded-xl p-4 text-text outline-none focus:border-accent/50 focus:bg-accent/5 transition-all"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="block text-xs font-bold uppercase tracking-widest text-muted">
              {t('webhooks.eventsLabel')}
            </label>
            <p className="text-xs text-muted">{t('webhooks.eventsDescription')}</p>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_EVENTS.map((eventName) => {
                const isSelected = selectedEvents.includes(eventName);
                return (
                  <button
                    key={eventName}
                    type="button"
                    onClick={() => toggleEvent(eventName)}
                    className={`px-3 py-2 rounded-lg text-xs font-mono border transition-all ${
                      isSelected
                        ? 'bg-accent/10 border-accent/50 text-accent'
                        : 'bg-black/20 border-hi text-muted hover:text-text'
                    }`}
                  >
                    {eventName}
                  </button>
                );
              })}
            </div>
          </div>

          {formError ? <p className="text-sm text-red-400">{formError}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="self-start px-6 py-3 rounded-xl font-bold bg-accent text-black hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {t('webhooks.createButton')}
          </button>
        </div>
      </form>

      <div className="w-full card glass noise p-8">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Webhook className="w-5 h-5" />
          {t('webhooks.listTitle')}
        </h2>

        {error ? <p className="text-sm text-red-400 mb-4">{error}</p> : null}

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">{t('webhooks.loading')}</span>
          </div>
        ) : null}

        {!isLoading && subscriptions.length === 0 && !error ? (
          <div className="text-muted text-center py-12">
            <Webhook className="w-8 h-8 opacity-30 mx-auto mb-3" />
            <p className="text-sm">{t('webhooks.empty')}</p>
          </div>
        ) : null}

        {!isLoading && subscriptions.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {subscriptions.map((subscription) => (
              <li
                key={subscription.id}
                className="flex items-center justify-between gap-4 bg-black/20 border border-hi rounded-xl p-4"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm truncate">{subscription.url}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {subscription.events.map((eventName) => (
                      <span
                        key={eventName}
                        className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-full bg-accent/10 text-accent"
                      >
                        {eventName}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(subscription.id)}
                  disabled={deletingId === subscription.id}
                  aria-label={t('webhooks.deleteButton')}
                  className="shrink-0 p-3 rounded-xl border border-hi text-red-400 hover:bg-red-500/10 hover:border-red-500/30 transition-all disabled:opacity-50"
                >
                  {deletingId === subscription.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
