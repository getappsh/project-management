/**
 * Generates the Vault secret path segment for a git source's credentials.
 * Convention: project-{gitSourceId}-git-credentials
 */
export function gitCredentialsSecretName(gitSourceId: number): string {
  return `project-${gitSourceId}-git-credentials`;
}
