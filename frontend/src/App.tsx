import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Sidebar, NavScreen } from './components/Sidebar';
import { SettingsModal } from './components/SettingsModal';
import { InputScreen } from './screens/InputScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { ExecutionScreen } from './screens/ExecutionScreen';
import { AuditScreen } from './screens/AuditScreen';
import { ActionRuntimeState, EvaluatedPlan, ExecutionEvent, LlmResponse } from './types/sentinel';
import { submitPlanRequest, executePlanWithStream, checkBackendHealth, requestUndoPlan } from './services/api';
import { evaluatePlan } from './engine/policyEngine';

export const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<NavScreen>('input');
  const [prompt, setPrompt] = useState('');
  const [dryRun, setDryRun] = useState(true); // Default to simulation mode for safety
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isLoading, setIsLoading] = useState(false);

  // Gemini Settings state
  const [geminiKey, setGeminiKey] = useState<string>(() => localStorage.getItem('sentinel_gemini_key') || '');
  const [geminiModel, setGeminiModel] = useState<string>(() => localStorage.getItem('sentinel_gemini_model') || 'gemini-flash-latest');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);

  const [currentPlan, setCurrentPlan] = useState<EvaluatedPlan | null>(null);
  const [clarificationQuestion, setClarificationQuestion] = useState<string | null>(null);

  // Execution state
  const [actionStates, setActionStates] = useState<ActionRuntimeState[]>([]);
  const [executionEvents, setExecutionEvents] = useState<ExecutionEvent[]>([]);
  const [isExecutionComplete, setIsExecutionComplete] = useState(false);

  // Check backend health on mount and periodically
  useEffect(() => {
    let isMounted = true;
    const verifyHealth = async () => {
      const health = await checkBackendHealth();
      if (isMounted) {
        setBackendOnline(health.online);
        if (health.model) {
          setGeminiModel(health.model);
        }
      }
    };

    verifyHealth();
    const interval = setInterval(verifyHealth, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const handleSubmitPrompt = async (promptText: string) => {
    setIsLoading(true);
    setClarificationQuestion(null);

    try {
      const response: LlmResponse = await submitPlanRequest(promptText, dryRun, geminiKey);

      if (response.type === 'NeedsClarification') {
        setClarificationQuestion(response.question);
        setCurrentScreen('input');
      } else if (response.type === 'Plan') {
        // Use embedded evaluation if available (from backend or direct Gemini path),
        // otherwise run the local policy engine to build a full EvaluatedPlan
        const planToSet: EvaluatedPlan = (response as any).evaluation ?? evaluatePlan(response.plan);
        setCurrentPlan(planToSet);
        setCurrentScreen('review');
      } else if (response.type === 'CannotDo') {
        alert(`Sentinel cannot perform this operation:\n\n${response.reason}`);
      }
    } catch (err: any) {
      alert(`Error synthesizing plan: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResolveClarification = (refinedText: string) => {
    setClarificationQuestion(null);
    setPrompt(refinedText);
    handleSubmitPrompt(refinedText);
  };

  const handleApprovePlan = () => {
    if (!currentPlan) return;

    // Initialize runtime states
    const initialStates: ActionRuntimeState[] = currentPlan.evaluated_actions.map(
      (ea, idx) => ({
        index: idx,
        action: ea.action,
        evaluated: ea,
        status: 'pending',
      })
    );

    setActionStates(initialStates);
    setExecutionEvents([]);
    setIsExecutionComplete(false);
    setCurrentScreen('execution');

    // Trigger execution with live events stream
    executePlanWithStream(currentPlan, dryRun, (event) => {
      setExecutionEvents((prev) => [...prev, event]);

      if (event.action_index !== undefined) {
        setActionStates((prev) =>
          prev.map((st) => {
            if (st.index === event.action_index) {
              if (event.type === 'ActionStarted') {
                return { ...st, status: 'running', message: event.message };
              }
              if (event.type === 'ActionCompleted') {
                return {
                  ...st,
                  status: 'completed',
                  message: event.message,
                  filesAffected: event.files_affected,
                  bytesFreed: event.bytes_freed,
                  details: event.details,
                };
              }
              if (event.type === 'ActionFailed') {
                return {
                  ...st,
                  status: 'failed',
                  error: event.error || event.message,
                };
              }
            }
            return st;
          })
        );
      }

      if (event.type === 'PlanCompleted') {
        setIsExecutionComplete(true);
      }
    });
  };

  const handleRollback = async () => {
    if (!currentPlan) return;
    const res = await requestUndoPlan(currentPlan.plan.id);
    alert(res.message);
  };

  return (
    <div className="app-layout">
      {/* Top Application Nav */}
      <Header
        currentScreen={currentScreen}
        dryRun={dryRun}
        setDryRun={setDryRun}
        theme={theme}
        setTheme={setTheme}
        onNavigateHome={() => setCurrentScreen('input')}
        backendOnline={backendOnline}
        geminiModel={geminiModel}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Main Workspace with Fixed Sidebar & Fluid Stage */}
      <div className="workspace-layout">
        <Sidebar
          currentScreen={currentScreen}
          onSelectScreen={setCurrentScreen}
          hasActivePlan={!!currentPlan}
          hasActiveExecution={actionStates.length > 0}
        />

        <main className="main-stage">
          {currentScreen === 'input' && (
            <InputScreen
              prompt={prompt}
              setPrompt={setPrompt}
              onSubmit={handleSubmitPrompt}
              isLoading={isLoading}
              clarificationQuestion={clarificationQuestion}
              onResolveClarification={handleResolveClarification}
              onCancelClarification={() => setClarificationQuestion(null)}
              dryRun={dryRun}
              setDryRun={setDryRun}
            />
          )}

          {currentScreen === 'review' && currentPlan && (
            <ReviewScreen
              evaluation={currentPlan}
              dryRun={dryRun}
              setDryRun={setDryRun}
              onApprove={handleApprovePlan}
              onCancel={() => setCurrentScreen('input')}
            />
          )}

          {currentScreen === 'execution' && currentPlan && (
            <ExecutionScreen
              evaluation={currentPlan}
              dryRun={dryRun}
              states={actionStates}
              events={executionEvents}
              isComplete={isExecutionComplete}
              onNewTask={() => {
                setPrompt('');
                setCurrentPlan(null);
                setCurrentScreen('input');
              }}
              onViewAudit={() => setCurrentScreen('audit')}
              onRollback={handleRollback}
            />
          )}

          {currentScreen === 'audit' && <AuditScreen />}
        </main>
      </div>

      {/* Gemini Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        geminiKey={geminiKey}
        setGeminiKey={setGeminiKey}
        geminiModel={geminiModel}
        setGeminiModel={setGeminiModel}
        backendOnline={backendOnline}
      />
    </div>
  );
};
