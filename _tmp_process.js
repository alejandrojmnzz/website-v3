const fs = require('fs');
const path = require('path');
const jsyaml = require('/home/runner/workspace/node_modules/js-yaml');

// ===== STEP 1: Create _common.single.yml files =====
const newFiles = {
  '4geeks-com/pages/_common.single.yml': 'meta:\n  robots: "index, follow"\n  priority: 0.8\n  change_frequency: monthly\nschema:\n  include:\n    - organization\n    - website\n',
  '4geeks-com/programs/_common.single.yml': 'meta:\n  robots: "index, follow"\n  priority: 0.9\n  change_frequency: weekly\nschema:\n  include:\n    - organization\n    - website\n',
  '4geeks-com/locations/_common.single.yml': 'visibility: listed\n',
  '4geeks-com/landings/_common.single.yml': 'meta:\n  robots: "index, follow"\n  priority: 0.9\n  change_frequency: weekly\nschema:\n  include:\n    - organization\n    - website\n',
  '4geeks-com/downloadable/_common.single.yml': 'meta:\n  robots: "index, follow"\n  priority: 0.9\n  change_frequency: weekly\nschema:\n  include:\n    - organization\n    - website\n',
};

for (const [fp, content] of Object.entries(newFiles)) {
  fs.writeFileSync(fp, content);
  console.log('Created: ' + fp);
}

// Blog - update existing
const blogPath = '4geeks-com/blog/_common.single.yml';
let blogRaw = fs.readFileSync(blogPath, 'utf8');
const blogData = jsyaml.load(blogRaw);
if (!blogData.meta) {
  blogRaw = blogRaw.trimEnd() + '\nmeta:\n  robots: "index, follow"\n  priority: 0.8\n  change_frequency: monthly\n';
}
if (!blogData.schema) {
  blogRaw = blogRaw.trimEnd() + '\nschema:\n  include:\n    - organization\n    - website\n';
}
fs.writeFileSync(blogPath, blogRaw);
console.log('Updated: ' + blogPath);

// ===== STEP 2: Process per-slug files =====
function norm(val) {
  if (typeof val === 'string') return val.replace(/['"]/g, '').trim();
  return val;
}

function processFiles(dir, defaultMeta, defaultSchemaInclude, extraKey) {
  const slugDirs = fs.readdirSync(dir).filter(d => {
    try { return fs.statSync(path.join(dir, d)).isDirectory() && !d.startsWith('_'); } catch(e) { return false; }
  });
  
  for (const slug of slugDirs) {
    const fp = path.join(dir, slug, '_common.yml');
    if (!fs.existsSync(fp)) continue;
    
    const raw = fs.readFileSync(fp, 'utf8');
    const data = jsyaml.load(raw);
    if (!data) continue;
    
    let removeEntireMeta = false;
    let metaKeysToRemove = [];
    let removeEntireSchema = false;
    let removeSchemaInclude = false;
    let removeExtra = false;
    
    // Meta analysis
    if (defaultMeta && data.meta) {
      for (const [key, defVal] of Object.entries(defaultMeta)) {
        if (key in data.meta && String(norm(data.meta[key])) === String(norm(defVal))) {
          metaKeysToRemove.push(key);
        }
      }
      const remaining = Object.keys(data.meta).filter(k => !metaKeysToRemove.includes(k));
      if (remaining.length === 0 && metaKeysToRemove.length > 0) removeEntireMeta = true;
    }
    
    // Schema analysis
    if (defaultSchemaInclude && data.schema && data.schema.include) {
      const inc = data.schema.include.map(x => norm(String(x)));
      const def = defaultSchemaInclude.map(x => norm(String(x)));
      if (inc.length === def.length && inc.every((v,i) => v === def[i])) {
        const otherKeys = Object.keys(data.schema).filter(k => k !== 'include');
        if (otherKeys.length === 0) removeEntireSchema = true;
        else removeSchemaInclude = true;
      }
    }
    
    // Extra key (visibility for locations)
    if (extraKey && data[extraKey.key] !== undefined) {
      if (String(norm(data[extraKey.key])) === String(norm(extraKey.value))) {
        removeExtra = true;
      }
    }
    
    if (!removeEntireMeta && metaKeysToRemove.length === 0 && !removeEntireSchema && !removeSchemaInclude && !removeExtra) continue;
    
    // Line-by-line processing
    const lines = raw.split('\n');
    const newLines = [];
    let i = 0;
    
    function skipBlock(startIndent) {
      i++;
      while (i < lines.length) {
        const l = lines[i];
        const s = l.trim();
        if (s === '') { i++; continue; }
        const ind = l.length - l.trimStart().length;
        if (ind > startIndent) { i++; continue; }
        break;
      }
    }
    
    while (i < lines.length) {
      const line = lines[i];
      const stripped = line.trim();
      const indent = line.length - line.trimStart().length;
      
      // Remove entire meta block
      if (removeEntireMeta && stripped === 'meta:' && indent === 0) {
        skipBlock(0);
        continue;
      }
      
      // Remove specific meta keys (indent=2, under meta:)
      if (!removeEntireMeta && metaKeysToRemove.length > 0 && indent === 2) {
        let skip = false;
        for (const key of metaKeysToRemove) {
          if (stripped.startsWith(key + ':')) { skip = true; break; }
        }
        if (skip) { i++; continue; }
      }
      
      // Remove entire schema block
      if (removeEntireSchema && stripped === 'schema:' && indent === 0) {
        skipBlock(0);
        continue;
      }
      
      // Remove schema include only
      if (removeSchemaInclude && stripped === 'include:' && indent === 2) {
        // Skip include: and its list items
        i++;
        while (i < lines.length) {
          const l = lines[i];
          const s = l.trim();
          const ind = l.length - l.trimStart().length;
          if (s === '') { i++; continue; }
          if (s.startsWith('- ') && ind >= 4) { i++; continue; }
          break;
        }
        continue;
      }
      
      // Remove extra key (visibility)
      if (removeExtra && indent === 0 && stripped.startsWith(extraKey.key + ':')) {
        i++;
        continue;
      }
      
      newLines.push(line);
      i++;
    }
    
    let result = newLines.join('\n');
    while (result.includes('\n\n\n')) result = result.replace(/\n\n\n/g, '\n\n');
    result = result.trimEnd() + '\n';
    
    // Check if meta block is now empty (only "meta:" with no children)
    // This can happen if we removed individual keys and nothing is left
    const resultData = jsyaml.load(result);
    if (resultData && resultData.meta && typeof resultData.meta === 'object' && Object.keys(resultData.meta).length === 0) {
      // Remove the empty meta: line
      result = result.split('\n').filter(l => l.trim() !== 'meta:').join('\n');
      while (result.includes('\n\n\n')) result = result.replace(/\n\n\n/g, '\n\n');
      result = result.trimEnd() + '\n';
    }
    
    fs.writeFileSync(fp, result);
    console.log('  Updated: ' + fp);
  }
}

console.log('\nProcessing pages...');
processFiles('4geeks-com/pages',
  { robots: 'index, follow', priority: 0.8, change_frequency: 'monthly' },
  ['organization', 'website'], null);

console.log('\nProcessing programs...');
processFiles('4geeks-com/programs',
  { robots: 'index, follow', priority: 0.9, change_frequency: 'weekly' },
  ['organization', 'website'], null);

console.log('\nProcessing locations...');
processFiles('4geeks-com/locations', null, null,
  { key: 'visibility', value: 'listed' });

console.log('\nProcessing landings...');
processFiles('4geeks-com/landings',
  { robots: 'index, follow', priority: 0.9, change_frequency: 'weekly' },
  ['organization', 'website'], null);

console.log('\nProcessing downloadable...');
processFiles('4geeks-com/downloadable',
  { robots: 'index, follow', priority: 0.9, change_frequency: 'weekly' },
  ['organization', 'website'], null);

console.log('\nDone!');
