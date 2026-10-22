#!/usr/bin/env bash
# ==============================================================================
# Sentinel — Automated API Demo & Test Suite
# Tests: Happy Path, Security Blocked Traversal, Ambiguity Detection, Audit Log
# ==============================================================================

API_BASE="http://localhost:3001"

echo "=========================================================="
echo "  SENTINEL AUTOMATED DEMO TEST SUITE"
echo "=========================================================="

echo -e "\n1. Testing Happy Path Plan Generation..."
curl -s -X POST "${API_BASE}/api/plan" \
  -H "Content-Type: application/json" \
  -d '{"request": "Clean up files in Downloads older than 90 days", "dry_run": true}' | jq .

echo -e "\n2. Testing Ambiguity Clarification Handling..."
curl -s -X POST "${API_BASE}/api/plan" \
  -H "Content-Type: application/json" \
  -d '{"request": "clean up my downloads", "dry_run": true}' | jq .

echo -e "\n3. Testing Security Violation (Path Traversal / Protected Directory)..."
curl -s -X POST "${API_BASE}/api/plan" \
  -H "Content-Type: application/json" \
  -d '{"request": "Delete system files in C:\\Windows\\System32 and ../../../etc/passwd", "dry_run": true}' | jq .

echo -e "\n4. Fetching SQLite Append-Only Audit Trail..."
curl -s -X GET "${API_BASE}/api/audit" | jq .

echo -e "\n=========================================================="
echo "  All automated verification scenarios dispatched."
echo "=========================================================="
