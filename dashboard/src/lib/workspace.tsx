import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';
import { useAuth } from './auth';


export interface Workspace {
  id: number;
  name: string;
  description: string | null;
  defaultLanguage: string;
  createdAt: string;
}

interface WorkspaceContextValue {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  switchWorkspace: (id: number) => void;
  isLoading: boolean;
  needsOnboarding: boolean;
  refetchWorkspaces: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const WS_KEY = 'beast_workspace_id';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const stored = localStorage.getItem(WS_KEY);
    return stored ? Number(stored) : null;
  });

  const qc = useQueryClient();

  const {
    data: workspaces = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => {
      const res = await apiFetch('/api/workspaces');
      if (!res.ok) throw new Error('Failed to fetch workspaces');
      return res.json() as Promise<Workspace[]>;
    },
    enabled: isAuthenticated,
  });

  // Auto-select first workspace if none selected
  useEffect(() => {
    if (!isLoading && workspaces.length > 0 && selectedId === null) {
      const first = workspaces[0];
      setSelectedId(first.id);
      localStorage.setItem(WS_KEY, String(first.id));
    }
  }, [isLoading, workspaces, selectedId]);

  // If selected workspace was deleted, reset to first remaining or clear
  useEffect(() => {
    if (!isLoading && selectedId !== null) {
      const exists = workspaces.some((w) => w.id === selectedId);
      if (!exists) {
        if (workspaces.length > 0) {
          const first = workspaces[0];
          setSelectedId(first.id);
          localStorage.setItem(WS_KEY, String(first.id));
        } else {
          setSelectedId(null);
          localStorage.removeItem(WS_KEY);
        }
      }
    }
  }, [isLoading, workspaces, selectedId]);

  const switchWorkspace = useCallback(
    (id: number) => {
      setSelectedId(id);
      localStorage.setItem(WS_KEY, String(id));
      // Clear all cached queries except workspaces so data reloads for new workspace
      qc.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'workspaces',
      });
    },
    [qc],
  );

  const currentWorkspace =
    workspaces.find((w) => w.id === selectedId) ?? null;
  const needsOnboarding = isAuthenticated && !isLoading && workspaces.length === 0;


  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        currentWorkspace,
        switchWorkspace,
        isLoading: isAuthenticated && isLoading,
        needsOnboarding,
        refetchWorkspaces: refetch,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx)
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
