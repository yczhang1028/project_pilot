export function sanitizeDisplayText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function formatSshHostProgressTitle(hostName: string): string {
  return `Testing SSH Host "${displayHostName(hostName)}"`;
}

export function formatSshHostProbeFailure(message: string): string {
  return sanitizeDisplayText(message)
    || 'SSH Host connection failed. Check the connection settings and try again.';
}

export function formatUnexpectedSshHostProbeFailure(hostName: string): string {
  return `Failed to connect to SSH Host "${displayHostName(hostName)}". Check the connection settings and try again.`;
}

export function displayHostName(hostName: string): string {
  return sanitizeDisplayText(hostName) || 'Unnamed Host';
}

interface MigrationProject {
  id?: string;
  sshHostId?: string;
}

export type CapturedSshHostMigration =
  | { success: true; projectIds: string[] }
  | { success: false; missingProjectCount: number };

export function captureSshHostMigrationProjectIds(
  projects: readonly MigrationProject[],
  sourceHostId: string
): CapturedSshHostMigration {
  const linkedProjects = projects.filter(project => project.sshHostId === sourceHostId);
  const missingProjectCount = linkedProjects.filter(project => (
    typeof project.id !== 'string' || project.id.trim().length === 0
  )).length;
  if (missingProjectCount > 0) {
    return { success: false, missingProjectCount };
  }

  return {
    success: true,
    projectIds: linkedProjects.map(project => project.id as string)
  };
}

interface SshHostMigrationStore {
  migrateSshHostProjects(sourceId: string, targetId: string, projectIds: string[]): Promise<void>;
}

export async function migrateCapturedSshHostProjects(
  store: SshHostMigrationStore,
  sourceId: string,
  targetId: string,
  projectIds: readonly string[]
): Promise<void> {
  await store.migrateSshHostProjects(sourceId, targetId, [...projectIds]);
}
