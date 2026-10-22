import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Sidebar, NavScreen } from './components/Sidebar';
import { InputScreen } from './screens/InputScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { ExecutionScreen } from './screens/ExecutionScreen';
import { AuditScreen } from './screens/AuditScreen';
import { ActionRuntimeState, EvaluatedPlan, ExecutionEvent, LlmResponse } from './types/sentinel';
import { submitPlanRequest, executePlanWithStream } from './services/api';

export const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<NavScreen>('input');
  const [prompt, setPrompt] = useState('');
  const [dryRun, setDryRun] = useState(true); // Default to simulation mode for safety
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isLoading, setIsLoading] = useState(false);

  const [currentPlan, setCurrentPlan] = useState<EvaluatedPlan | null>(null);
  const [clarificationQuestion, setClarificationQuestion] = useState<string | null>(null);

  // Execution state
  const [actionStates, setActionStates] = useState<ActionRuntimeState[]>([]);
  const [executionEvents, setExecutionEvents] = useState<ExecutionEvent[]>([]);
  const [isExecutionComplete, setIsExecutionComplete] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const handleSubmitPrompt = async (promptText: string) => {
    setIsLoading(true);
    setClarificationQuestion(null);

    try {
      const response: LlmResponse = await submitPlanRequest(promptText, dryRun);

      if (response.type === 'NeedsClarification') {
        setClarificationQuestion(response.question);
        setCurrentScreen('input');
      } else if (response.type === 'Plan') {
        setCurrentPlan(response.evaluation);
        setCurrentScreen('review');
      } else if (response.type === 'CannotDo') {
        alert(`Sentinel cannot perform this operation: ${response.reason}`);
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
                };
              }
              if (event.type === 'ActionFailed') {
                return {
                  ...st,
                  status: 'failed',
                  error: event.error,
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

  const handleCancelPlan = () => {
    setCurrentScreen('input');
  };

  const handleNewTask = () => {
    setCurrentPlan(null);
    setPrompt('');
    setClarificationQuestion(null);
    setActionStates([]);
    setExecutionEvents([]);
    setIsExecutionComplete(false);
    setCurrentScreen('input');
  };

  const handleSelectScreen = (screen: NavScreen) => {
    if (screen === 'input') {
      setClarificationQuestion(null);
    }
    setCurrentScreen(screen);
  };

  return (
    <div className="app-shell">
      <Header
        currentScreen={currentScreen}
        dryRun={dryRun}
        setDryRun={setDryRun}
        theme={theme}
        setTheme={setTheme}
        onNavigateHome={handleNewTask}
      />

      <div className="main-layout">
        <Sidebar
          currentScreen={currentScreen}
          onSelectScreen={handleSelectScreen}
          hasActivePlan={currentPlan !== null}
          hasActiveExecution={actionStates.length > 0}
        />

        <main className="content-viewport">
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
              onCancel={handleCancelPlan}
            />
          )}

          {currentScreen === 'execution' && currentPlan && (
            <ExecutionScreen
              evaluation={currentPlan}
              states={actionStates}
              events={executionEvents}
              isComplete={isExecutionComplete}
              dryRun={dryRun}
              onViewAudit={() => setCurrentScreen('audit')}
              onNewTask={handleNewTask}
            />
          )}

          {currentScreen === 'audit' && <AuditScreen />}
        </main>
      </div>
    </div>
  );
};
