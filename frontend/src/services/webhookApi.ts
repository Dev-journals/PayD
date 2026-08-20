import axios from 'axios';

const RAW_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';
const API_ROOT = RAW_API_URL.replace(/\/api\/v1\/?$/, '').replace(/\/api\/?$/, '');
const WEBHOOKS_URL = `${API_ROOT}/webhooks`;

function authHeaders() {
  const token = localStorage.getItem('payd_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  organizationId: number;
}

export interface CreateWebhookSubscriptionInput {
  url: string;
  secret: string;
  events: string[];
}

export async function fetchWebhookSubscriptions(): Promise<WebhookSubscription[]> {
  const { data } = await axios.get<WebhookSubscription[]>(`${WEBHOOKS_URL}/subscriptions`, {
    headers: authHeaders(),
  });
  return data;
}

export async function createWebhookSubscription(
  input: CreateWebhookSubscriptionInput
): Promise<WebhookSubscription> {
  const { data } = await axios.post<WebhookSubscription>(`${WEBHOOKS_URL}/subscribe`, input, {
    headers: authHeaders(),
  });
  return data;
}

export async function deleteWebhookSubscription(id: string): Promise<void> {
  await axios.delete(`${WEBHOOKS_URL}/subscriptions/${id}`, {
    headers: authHeaders(),
  });
}
