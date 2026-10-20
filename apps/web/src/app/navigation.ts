import {
  BarChart3,
  Bug,
  ClipboardCheck,
  Columns3,
  FileCode2,
  FolderKanban,
  GitBranch,
  ListChecks,
  ListTodo,
  Settings,
  Table2,
  Users,
  CalendarRange,
  type LucideIcon,
} from 'lucide-react';

export interface NavModule {
  slug: string;
  label: string;
  icon: LucideIcon;
  /** Delivery phase in which the module is built (see docs/ARCHITECTURE.md). */
  phase: number;
  /** Implemented modules link to a real page; the rest show Coming Soon. */
  implemented: boolean;
  /** Path for implemented modules; project-scoped paths receive the current project id. */
  path?: (projectId: string | null) => string;
  summary: string;
}

export interface NavGroup {
  label: string;
  modules: NavModule[];
}

export const NAVIGATION: NavGroup[] = [
  {
    label: 'Product Design',
    modules: [
      {
        slug: 'process-designer',
        label: 'Process Designer',
        icon: GitBranch,
        phase: 1,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/processes` : '/projects'),
        summary: 'Describe business processes in natural language and turn them into interactive process maps.',
      },
      {
        slug: 'io-designer',
        label: 'Input & Output Designer',
        icon: Table2,
        phase: 2,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/data` : '/projects'),
        summary: 'Define the fields, validation rules and outputs of each process activity in a shared data dictionary.',
      },
      {
        slug: 'tech-user-stories',
        label: 'Tech User Story',
        icon: FileCode2,
        phase: 3,
        implemented: false,
        summary: 'Generate functional and technical implementation stories from approved processes and data requirements.',
      },
      {
        slug: 'business-user-stories',
        label: 'Business User Story',
        icon: ListChecks,
        phase: 5,
        implemented: false,
        summary: 'Generate end-to-end business scenarios for user acceptance testing.',
      },
    ],
  },
  {
    label: 'Delivery Management',
    modules: [
      {
        slug: 'backlog',
        label: 'Product Backlog',
        icon: ListTodo,
        phase: 4,
        implemented: false,
        summary: 'Prioritise approved stories in a central backlog.',
      },
      {
        slug: 'sprints',
        label: 'Sprint Planning',
        icon: CalendarRange,
        phase: 4,
        implemented: false,
        summary: 'Plan sprints against team capacity.',
      },
      {
        slug: 'kanban',
        label: 'Development Kanban',
        icon: Columns3,
        phase: 4,
        implemented: false,
        summary: 'Track development work from To-do to Completed.',
      },
    ],
  },
  {
    label: 'Quality Assurance',
    modules: [
      {
        slug: 'business-testing',
        label: 'Business Testing',
        icon: ClipboardCheck,
        phase: 5,
        implemented: false,
        summary: 'Execute UAT scenarios step by step and record results.',
      },
      {
        slug: 'defects',
        label: 'Defect Tracking',
        icon: Bug,
        phase: 5,
        implemented: false,
        summary: 'Manage defects raised from testing.',
      },
    ],
  },
  {
    label: 'Analytics',
    modules: [
      {
        slug: 'dashboard',
        label: 'Delivery Dashboard',
        icon: BarChart3,
        phase: 6,
        implemented: false,
        summary: 'Sprint velocity, burndown, workload and UAT progress from stored delivery data.',
      },
    ],
  },
  {
    label: 'Administration',
    modules: [
      {
        slug: 'projects',
        label: 'Projects',
        icon: FolderKanban,
        phase: 1,
        implemented: true,
        path: () => '/projects',
        summary: 'Create projects and manage who can access them.',
      },
      {
        slug: 'users',
        label: 'Users & Roles',
        icon: Users,
        phase: 7,
        implemented: false,
        summary: 'Organisation-wide user administration. Project membership is already managed from each project.',
      },
      {
        slug: 'settings',
        label: 'Settings',
        icon: Settings,
        phase: 7,
        implemented: false,
        summary: 'Workspace and workflow configuration.',
      },
    ],
  },
];

export function findModule(slug: string): NavModule | undefined {
  return NAVIGATION.flatMap((g) => g.modules).find((m) => m.slug === slug);
}
