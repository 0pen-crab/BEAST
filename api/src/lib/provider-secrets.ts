export interface SecretFieldDef {
  label: string;
  displayName: string;
  required: boolean;
}

export const PROVIDER_SECRETS: Record<string, SecretFieldDef[]> = {
  bitbucket: [
    { label: 'access_token', displayName: 'API Token', required: true },
  ],
  github: [
    { label: 'access_token', displayName: 'Personal Access Token', required: true },
  ],
  gitlab: [
    { label: 'access_token', displayName: 'Access Token', required: true },
  ],
  jfrog: [
    { label: 'api_token', displayName: 'API Token', required: true },
  ],
};
