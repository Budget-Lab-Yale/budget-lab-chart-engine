// Browser IIFE entry point: exposes mountChart on globalThis.BudgetLabChart so the
// standalone HTML can call BudgetLabChart.mountChart(el, { spec, rows }).
import { mountChart } from "../engine/render-live";

(globalThis as Record<string, unknown>).BudgetLabChart = { mountChart };
