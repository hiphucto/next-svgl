// src/commands/add.ts
import axios from 'axios';
import inquirer from 'inquirer';
import { iSVG } from '../types';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';

export const add = async (args?: string[]) => {
  try {
    const spinner = ora('Fetching SVGs...').start();

    // Fetch all SVGs from the API
    const response = await axios.get<iSVG[]>('https://api.svgl.app');
    const svgs = response.data;

    // Stop spinner after fetch
    spinner.stop();

    if (!svgs || svgs.length === 0) {
      console.error('No SVGs found in the repository.');
      return;
    }

    let selectedSVGs: iSVG[] = [];

    // Check if SVG names were provided via command line
    if (args && args.length > 0) {
      const requestedNames = args.map((name) => name.toLowerCase());

      // Filter SVGs based on EXACT requested names (not partial matches)
      selectedSVGs = svgs.filter((svg) => {
        const svgName = svg.title.toLowerCase();
        const kebabName = svg.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        return requestedNames.some(
          (name) =>
            kebabName === name.toLowerCase() || svgName === name.toLowerCase()
        );
      });

      if (selectedSVGs.length === 0) {
        console.error('None of the requested SVGs were found.');
        console.log('Available SVGs:');
        // Show some example SVGs to help user
        console.log(
          svgs
            .slice(0, 10)
            .map((svg) =>
              svg.title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
            )
            .join(', ') + '...'
        );
        return;
      }

      // Log which exact SVGs were found
      console.log(
        `Found ${selectedSVGs.length} exact match${selectedSVGs.length !== 1 ? 'es' : ''}: ${selectedSVGs.map((svg) => svg.title).join(', ')}`
      );

      // Report any names that weren't found
      const foundNames = selectedSVGs
        .map((svg) => {
          const kebabName = svg.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          return [svg.title.toLowerCase(), kebabName];
        })
        .flat();

      const notFound = requestedNames.filter(
        (name) =>
          !foundNames.some((foundName) => foundName === name.toLowerCase())
      );

      if (notFound.length > 0) {
        console.log(`Could not find exact matches for: ${notFound.join(', ')}`);
      }
    } else {
      // Use interactive prompt if no arguments provided
      // Prepare choices for inquirer
      const choices = svgs.map((svg) => ({
        name: `${svg.title} (${svg.category}) - ${svg.url}`,
        value: svg,
      }));

      // Update prompt to allow multiple selections
      const { selectedSVGs: selected } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedSVGs',
          message:
            'Select SVGs to add (use space to select, enter to confirm):',
          choices,
        },
      ]);

      selectedSVGs = selected;
    }

    // Create React components for selected SVGs
    if (selectedSVGs.length > 0) {
      const componentSpinner = ora('Creating React components...').start();

      // Create the destination directory if it doesn't exist
      const componentsDir = path.join(process.cwd(), 'components', 'svgl');
      await fs.ensureDir(componentsDir);

      // Track what we've created for later generating index.tsx
      const createdComponents = [];

      // Process each selected SVG
      for (const svg of selectedSVGs) {
        try {
          const componentName = svg.title.replace(/[^a-zA-Z0-9]/g, '');
          // Convert component name to kebab-case for file name
          const fileName = svg.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

          let componentContent = '';

          if (typeof svg.route === 'string') {
            // Single version - fetch SVG content
            const svgResponse = await axios.get(svg.route);
            const svgContent = svgResponse.data;

            // Extract the SVG content without preserving width/height attributes
            const svgMarkup = extractSvgContent(svgContent);

            // Create component
            componentContent = `import React from 'react';

interface ${componentName}Props {
  className?: string;
  width?: number | string;
  height?: number | string;
}

export const ${componentName}: React.FC<${componentName}Props> = ({
  className,
  width = 24,
  height = 24,
  ...props
}) => {
  return (
    ${svgMarkup.replace(/<svg/, '<svg className={className} width={width} height={height} {...props}')}
  );
};
`;
          } else {
            // Theme variants - fetch both light and dark
            const lightResponse = await axios.get(svg.route.light);
            const lightSvgContent = lightResponse.data;
            const lightSvgMarkup = extractSvgContent(lightSvgContent);

            const darkResponse = await axios.get(svg.route.dark);
            const darkSvgContent = darkResponse.data;
            const darkSvgMarkup = extractSvgContent(darkSvgContent);

            // Create component with theme support
            componentContent = `import React, { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

interface ${componentName}Props {
  className?: string;
  width?: number | string;
  height?: number | string;
}

export const ${componentName}: React.FC<${componentName}Props> = ({
  className,
  width = 24,
  height = 24,
  ...props
}) => {
  const { resolvedTheme } = useTheme();
  // Add client-side only rendering to avoid hydration mismatch
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // During SSR and initial client render, default to light theme
  const isDark = mounted && resolvedTheme === 'dark';

  return isDark ? (
    ${darkSvgMarkup.replace(/<svg/, '<svg\n      className={className}\n      width={width}\n      height={height}\n      {...props}')}
  ) : (
    ${lightSvgMarkup.replace(/<svg/, '<svg\n      className={className}\n      width={width}\n      height={height}\n      {...props}')}
  );
};
`;
          }

          // Create separate component file with kebab-case filename
          const componentPath = path.join(componentsDir, `${fileName}.tsx`);
          await fs.writeFile(componentPath, componentContent);
          componentSpinner.text = `Created: ${fileName}.tsx`;

          // Add to tracking array for index generation with both the component name and file name
          createdComponents.push({
            name: componentName,
            fileName: fileName,
            hasDarkLight: typeof svg.route !== 'string',
          });

          // Handle wordmark if available
          if (svg.wordmark) {
            let wordmarkContent = '';
            const wordmarkFileName = `${fileName}-wordmark`;

            if (typeof svg.wordmark === 'string') {
              // Single wordmark
              const wordmarkResponse = await axios.get(svg.wordmark);
              const wordmarkSvgContent = wordmarkResponse.data;
              const wordmarkSvgMarkup = extractSvgContent(wordmarkSvgContent);

              wordmarkContent = `import React from 'react';

interface ${componentName}WordmarkProps {
  className?: string;
  width?: number | string;
  height?: number | string;
}

export const ${componentName}Wordmark: React.FC<${componentName}WordmarkProps> = ({
  className,
  width = 100,
  height = 24,
  ...props
}) => {
  return (
    ${wordmarkSvgMarkup.replace(/<svg/, '<svg className={className} width={width} height={height} {...props}')}
  );
};
`;
            } else {
              // Themed wordmarks
              const lightWordmarkResponse = await axios.get(svg.wordmark.light);
              const lightWordmarkContent = lightWordmarkResponse.data;
              const lightWordmarkMarkup =
                extractSvgContent(lightWordmarkContent);

              const darkWordmarkResponse = await axios.get(svg.wordmark.dark);
              const darkWordmarkContent = darkWordmarkResponse.data;
              const darkWordmarkMarkup = extractSvgContent(darkWordmarkContent);

              wordmarkContent = `import React from 'react';
import { useTheme } from 'next-themes';

interface ${componentName}WordmarkProps {
  className?: string;
  width?: number | string;
  height?: number | string;
}

export const ${componentName}Wordmark: React.FC<${componentName}WordmarkProps> = ({
  className,
  width = 100,
  height = 24,
  ...props
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return isDark ? (
    ${darkWordmarkMarkup.replace(/<svg/, '<svg className={className} width={width} height={height} {...props}')}
  ) : (
    ${lightWordmarkMarkup.replace(/<svg/, '<svg className={className} width={width} height={height} {...props}')}
  );
};
`;
            }

            // Create wordmark component file with kebab-case filename
            const wordmarkPath = path.join(
              componentsDir,
              `${wordmarkFileName}.tsx`
            );
            await fs.writeFile(wordmarkPath, wordmarkContent);
            componentSpinner.text = `Created: ${wordmarkFileName}.tsx`;

            // Add to tracking array
            createdComponents.push({
              name: `${componentName}Wordmark`,
              fileName: wordmarkFileName,
              hasDarkLight: typeof svg.wordmark !== 'string',
              isWordmark: true,
            });
          }
        } catch (error) {
          console.error(
            `Failed to create component for ${svg.title}: ${error}`
          );
        }
      }

      // Generate index.tsx with correct import paths
      // First, read all existing component files to include them too
      const componentFiles = await fs.readdir(componentsDir);
      const allComponents = [...createdComponents];

      // Add existing components that weren't just created
      for (const file of componentFiles) {
        if (file.endsWith('.tsx') && file !== 'index.tsx') {
          const fileName = file.replace('.tsx', '');

          // Check if this component is already in our created components list
          const existingComp = allComponents.find(
            (comp) => comp.fileName === fileName
          );
          if (!existingComp) {
            // Read the file to extract the component name
            const fileContent = await fs.readFile(
              path.join(componentsDir, file),
              'utf8'
            );
            const matches = fileContent.match(/export const (\w+):/);
            if (matches && matches[1]) {
              allComponents.push({
                name: matches[1],
                fileName: fileName,
                hasDarkLight: fileContent.includes('useTheme'),
                isWordmark: fileName.includes('-wordmark'),
              });
            }
          }
        }
      }

      const indexContent = `
import React from 'react';

${allComponents.map((comp) => `import { ${comp.name} } from './${comp.fileName}';`).join('\n')}

export {
  ${allComponents.map((comp) => comp.name).join(',\n  ')}
};
`;

      await fs.writeFile(path.join(componentsDir, 'index.tsx'), indexContent);
      componentSpinner.succeed(
        `Created ${createdComponents.length} new React components and exported all ${allComponents.length} components in components/svgl/`
      );

      console.log('\nTo use your SVG icons:');
      console.log(
        `import { ${createdComponents[0]?.name || 'ComponentName'} } from 'components/svgl';`
      );
      console.log(
        `<${createdComponents[0]?.name || 'ComponentName'} width={32} height={32} />`
      );
    }
  } catch (err) {
    console.error(`Failed to fetch or process SVGs: ${err}`);
  }
};

// Helper function to extract SVG content and make it suitable for embedding
function extractSvgContent(svgString: string): string {
  // This is a simple extraction. You might need more sophisticated parsing for complex SVGs
  return svgString
    .trim()
    .replace(/width="[^"]*"/, '') // Remove fixed width
    .replace(/height="[^"]*"/, ''); // Remove fixed height
}
