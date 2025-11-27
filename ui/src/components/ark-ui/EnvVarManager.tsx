/**
 * Environment Variable Manager Component
 *
 * Allows users to add environment variables for tool authentication
 * Stores variables in localStorage for persistence across sessions
 *
 * When Neo4j credentials (NEO4J_USER, NEO4J_PASSWORD) change,
 * the Neo4j driver connection is reset to pick up new credentials.
 */

import { createSignal, For, Show } from 'solid-js';
import { Dialog } from '@ark-ui/solid/dialog';
import { resetNeo4jConnection } from '~/lib/neo4j/queries';

// ============================================================================
// Types
// ============================================================================

interface EnvVar {
  name: string;
  value: string;
  masked: boolean;
}

export interface EnvVarManagerProps {
  onUpdate?: (vars: Record<string, string>) => void;
}

// ============================================================================
// LocalStorage Keys
// ============================================================================

const ENV_VARS_KEY = 'kg_agent_env_vars';

// ============================================================================
// Helper Functions
// ============================================================================

function loadEnvVars(): EnvVar[] {
  try {
    const stored = localStorage.getItem(ENV_VARS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveEnvVars(vars: EnvVar[]): void {
  localStorage.setItem(ENV_VARS_KEY, JSON.stringify(vars));
}

export function getEnvVarsAsRecord(): Record<string, string> {
  const vars = loadEnvVars();
  return vars.reduce((acc, { name, value }) => {
    acc[name] = value;
    return acc;
  }, {} as Record<string, string>);
}

// ============================================================================
// Component
// ============================================================================

export const EnvVarManager = (props: EnvVarManagerProps) => {
  const [envVars, setEnvVars] = createSignal<EnvVar[]>(loadEnvVars());
  const [newName, setNewName] = createSignal('');
  const [newValue, setNewValue] = createSignal('');
  const [showDialog, setShowDialog] = createSignal(false);

  const addEnvVar = async () => {
    const name = newName().trim();
    const value = newValue().trim();

    if (!name || !value) return;

    const updated = [
      ...envVars().filter(v => v.name !== name), // Remove existing if updating
      { name, value, masked: true }
    ];

    setEnvVars(updated);
    saveEnvVars(updated);
    props.onUpdate?.(getEnvVarsAsRecord());

    // If Neo4j credentials changed, reset the connection
    if (name === 'NEO4J_USER' || name === 'NEO4J_PASSWORD') {
      try {
        await resetNeo4jConnection();
        console.log('✅ Neo4j connection reset after credential change');
      } catch (error) {
        console.error('Failed to reset Neo4j connection:', error);
      }
    }

    // Reset form
    setNewName('');
    setNewValue('');
  };

  const removeEnvVar = async (name: string) => {
    const updated = envVars().filter(v => v.name !== name);
    setEnvVars(updated);
    saveEnvVars(updated);
    props.onUpdate?.(getEnvVarsAsRecord());

    // If Neo4j credentials removed, reset the connection to use defaults
    if (name === 'NEO4J_USER' || name === 'NEO4J_PASSWORD') {
      try {
        await resetNeo4jConnection();
        console.log('✅ Neo4j connection reset after credential removal');
      } catch (error) {
        console.error('Failed to reset Neo4j connection:', error);
      }
    }
  };

  const toggleMask = (name: string) => {
    const updated = envVars().map(v =>
      v.name === name ? { ...v, masked: !v.masked } : v
    );
    setEnvVars(updated);
  };

  return (
    <>
      {/* Trigger Button */}
      <button
        onClick={() => setShowDialog(true)}
        p="x-3 y-2"
        text="xs dark-text-primary"
        bg="dark-bg-tertiary hover:dark-bg-hover"
        border="1 dark-border-secondary"
        rounded="md"
        cursor="pointer"
        transition="colors"
        flex="~"
        items="center"
        gap="2"
      >
        <svg
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        <span>Env Vars ({envVars().length})</span>
      </button>

      {/* Dialog */}
      <Dialog.Root
        open={showDialog()}
        onOpenChange={(details) => setShowDialog(details.open)}
      >
        <Dialog.Backdrop
          {...({
            bg: "black/50",
            position: "fixed",
            top: "0",
            left: "0",
            w: "full",
            h: "full",
            z: "40"
          } as Record<string, string>)}
        />
        <Dialog.Positioner
          {...({
            position: "fixed",
            top: "0",
            left: "0",
            w: "full",
            h: "full",
            z: "50",
            flex: "~",
            items: "center",
            justify: "center"
          } as Record<string, string>)}
        >
          <Dialog.Content
            bg="dark-bg-primary"
            border="1 dark-border-primary"
            rounded="lg"
            shadow="xl"
            max-w="2xl"
            w="full"
            m="4"
            max-h="[80vh]"
            flex="~ col"
          >
            {/* Header */}
            <Dialog.Title
              p="6"
              border="b dark-border-primary"
              text="xl dark-text-primary"
              font="semibold"
              flex="~"
              items="center"
              justify="between"
            >
              <span>Environment Variables</span>
              <Dialog.CloseTrigger
                p="2"
                text="dark-text-tertiary hover:dark-text-primary"
                cursor="pointer"
                transition="colors"
              >
                <svg
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </Dialog.CloseTrigger>
            </Dialog.Title>

            {/* Body */}
            <div flex="1" overflow="auto" p="6">
              <Dialog.Description text="sm dark-text-secondary" m="b-6">
                Add environment variables for tool authentication. These are stored locally in your browser.
              </Dialog.Description>

              {/* Add New Variable Form */}
              <div bg="dark-bg-secondary" border="1 dark-border-secondary" rounded="lg" p="4" m="b-6">
                <div text="sm dark-text-primary" font="medium" m="b-3">
                  Add New Variable
                </div>

                <div flex="~ col" gap="3">
                  <div>
                    <label text="xs dark-text-tertiary" m="b-1" block>
                      Variable Name
                    </label>
                    <input
                      type="text"
                      value={newName()}
                      onInput={(e) => setNewName(e.currentTarget.value)}
                      placeholder="e.g., GROQ_API_KEY"
                      w="full"
                      p="x-3 y-2"
                      bg="dark-bg-tertiary"
                      text="sm dark-text-primary"
                      border="1 dark-border-secondary"
                      rounded="md"
                      outline="none focus:border-neon-cyan/50"
                      transition="colors"
                    />
                  </div>

                  <div>
                    <label text="xs dark-text-tertiary" m="b-1" block>
                      Value
                    </label>
                    <input
                      type="password"
                      value={newValue()}
                      onInput={(e) => setNewValue(e.currentTarget.value)}
                      placeholder="Enter value..."
                      w="full"
                      p="x-3 y-2"
                      bg="dark-bg-tertiary"
                      text="sm dark-text-primary"
                      border="1 dark-border-secondary"
                      rounded="md"
                      outline="none focus:border-neon-cyan/50"
                      transition="colors"
                    />
                  </div>

                  <button
                    onClick={addEnvVar}
                    disabled={!newName().trim() || !newValue().trim()}
                    p="x-4 y-2"
                    text="sm dark-text-primary"
                    bg="neon-cyan/20 hover:neon-cyan/30 disabled:opacity-50"
                    border="1 neon-cyan/50"
                    rounded="md"
                    cursor="pointer disabled:cursor-not-allowed"
                    transition="all"
                    font="medium"
                  >
                    Add Variable
                  </button>
                </div>
              </div>

              {/* Existing Variables List */}
              <div>
                <div text="sm dark-text-primary" font="medium" m="b-3">
                  Saved Variables ({envVars().length})
                </div>

                <Show
                  when={envVars().length > 0}
                  fallback={
                    <div text="sm dark-text-tertiary" text-align="center" p="4">
                      No environment variables saved yet
                    </div>
                  }
                >
                  <div flex="~ col" gap="2">
                    <For each={envVars()}>
                      {(envVar) => (
                        <div
                          bg="dark-bg-tertiary"
                          border="1 dark-border-secondary"
                          rounded="md"
                          p="3"
                          flex="~"
                          items="center"
                          gap="3"
                        >
                          {/* Name */}
                          <div flex="1" min-w="0">
                            <div text="xs dark-text-tertiary" m="b-1">
                              {envVar.name}
                            </div>
                            <div
                              text="sm dark-text-primary"
                              font="mono"
                              truncate
                            >
                              {envVar.masked ? '••••••••••••' : envVar.value}
                            </div>
                          </div>

                          {/* Actions */}
                          <div flex="~" gap="2">
                            <button
                              onClick={() => toggleMask(envVar.name)}
                              p="2"
                              text="dark-text-tertiary hover:dark-text-primary"
                              cursor="pointer"
                              transition="colors"
                              title={envVar.masked ? 'Show' : 'Hide'}
                            >
                              <svg
                                width="16"
                                height="16"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <Show
                                  when={envVar.masked}
                                  fallback={
                                    <path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      stroke-width="2"
                                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                                    />
                                  }
                                >
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                  />
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                  />
                                </Show>
                              </svg>
                            </button>

                            <button
                              onClick={() => removeEnvVar(envVar.name)}
                              p="2"
                              text="red-400 hover:red-300"
                              cursor="pointer"
                              transition="colors"
                              title="Delete"
                            >
                              <svg
                                width="16"
                                height="16"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>

            {/* Footer */}
            <div
              border="t dark-border-primary"
              p="6"
              flex="~"
              justify="end"
            >
              <Dialog.CloseTrigger
                p="x-4 y-2"
                text="sm dark-text-primary"
                bg="dark-bg-tertiary hover:dark-bg-hover"
                border="1 dark-border-secondary"
                rounded="md"
                cursor="pointer"
                transition="colors"
              >
                Close
              </Dialog.CloseTrigger>
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </>
  );
};
