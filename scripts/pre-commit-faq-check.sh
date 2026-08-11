#!/bin/bash
# Pre-commit hook for FAQ validation
# Checks that all FAQ database (frequently_asked_questions) entries have been updated within the last 6 months
#
# To install:
#   cp scripts/pre-commit-faq-check.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# Or add to your existing pre-commit hook

set -e

echo "Validating FAQ freshness..."

# Run the FAQ validator using tsx
npx tsx -e "
import { faqsValidator } from './scripts/validation/validators/faqs.ts';
import type { ValidationContext } from './scripts/validation/shared/types.ts';

async function run() {
  const context = {
    contentFiles: [],
    redirectMap: new Map(),
    validUrls: new Set(),
    availableSchemas: new Set(),
    sitemapEntries: [],
  };

  const result = await faqsValidator.run(context);
  
  if (result.status === 'failed') {
    console.error('\n[FAIL] FAQ Validation Failed!\n');
    console.error('The following FAQ entries need attention:\n');
    
    for (const error of result.errors) {
      console.error(\`  • \${error.message}\`);
      if (error.suggestion) {
        console.error(\`    Suggestion: \${error.suggestion}\`);
      }
      console.error('');
    }
    
    console.error(\`Total issues: \${result.errors.length}\`);
    console.error('\nPlease update stale FAQ answers before committing.\n');
    process.exit(1);
  }
  
  if (result.warnings.length > 0) {
    console.warn('[WARN] FAQ Validation Warnings:');
    for (const warning of result.warnings) {
      console.warn(\`  • \${warning.message}\`);
    }
    console.warn('');
  }
  
  console.log('[PASS] FAQ validation passed!');
  console.log(\`   Checked \${result.artifacts?.totalFAQs || 0} FAQs across 2 files.\`);
}

run().catch((err) => {
  console.error('FAQ validation error:', err);
  process.exit(1);
});
"

echo ""
