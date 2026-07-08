import React from 'react';
import type { ManagerLayout } from './managerLayout';
import type { ProjectItem, ProjectType } from './model';

const typeIcons: Record<ProjectType, string> = {
  local: '📂',
  workspace: '📦',
  ssh: '🖥️',
  'ssh-workspace': '📡'
};

export function ProjectLayout({
  layout,
  children
}: {
  layout: ManagerLayout;
  children: React.ReactNode;
}) {
  return <div className={`project-layout project-layout--${layout}`}>{children}</div>;
}

export function FavoriteProjectsRail({
  projects,
  onOpen
}: {
  projects: readonly ProjectItem[];
  onOpen(project: ProjectItem): void;
}) {
  const favorites = projects.filter(project => project.isFavorite).slice(0, 6);
  if (!favorites.length) {
    return null;
  }

  return (
    <section className="favorites-rail" aria-label="Favorite projects">
      <div className="favorites-rail__title">Favorites</div>
      <div className="favorites-rail__items">
        {favorites.map(project => (
          <button
            key={project.id ?? project.path}
            className="favorite-project"
            onClick={() => onOpen(project)}
            title={`Open ${project.name}`}
          >
            <span className="favorite-project__icon" style={{ borderColor: project.color, color: project.color }}>
              {project.icon
                ? <img src={project.icon} alt={project.name} />
                : typeIcons[project.type]}
            </span>
            <span className="truncate">{project.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
