import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackCodeEditor,
  SandpackPreview,
  useActiveCode,
  SandpackConsole,
  FileTabs,
} from "@codesandbox/sandpack-react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { FileText, Moon, Sun, Code2, Play, Save } from "lucide-react";

const defaultFiles = {
  "/App.js": `import React from 'react';

export default function App() {
  return (
    <div style={{ padding: '20px' }}>
      <h1>Hello Sandpack!</h1>
      <p>Start editing to see the magic happen</p>
    </div>
  );
}`,
  "/styles.css": `
body {
  margin: 0;
  padding: 20px;
  font-family: sans-serif;
}`,
  "/utils.js": `
export const formatDate = (date) => {
  return new Date(date).toLocaleDateString();
};`,
};

const useTerminal = (theme: "light" | "dark") => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const initializeTerminal = useCallback(() => {
    // Cleanup existing terminal
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.dispose();
      terminalInstanceRef.current = null;
    }

    // Ensure the container exists and has dimensions
    if (terminalRef.current) {
      // Explicitly set container dimensions
      terminalRef.current.style.width = "100%";
      terminalRef.current.style.height = "200px";
      terminalRef.current.style.minHeight = "200px";

      const terminal = new Terminal({
        cursorBlink: true,
        theme: {
          background: theme === "dark" ? "#1a1b1e" : "#ffffff",
          foreground: theme === "dark" ? "#ffffff" : "#000000",
        },
        // Ensure proper sizing
        cols: 80,
        rows: 10,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      try {
        // Open terminal in the container
        terminal.open(terminalRef.current);

        // Attempt to fit the terminal
        fitAddon.fit();

        // Initial prompt
        terminal.write("npm $ ");

        // Store references
        terminalInstanceRef.current = terminal;
        fitAddonRef.current = fitAddon;
      } catch (error) {
        console.error("Terminal initialization error:", error);
      }
    }
  }, [theme]);

  // Initialize terminal on mount and theme change
  useEffect(() => {
    initializeTerminal();

    // Resize handler
    const resizeHandler = () => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch (error) {
          console.error("Terminal resize error:", error);
        }
      }
    };

    // Add resize listener
    window.addEventListener("resize", resizeHandler);

    // Cleanup
    return () => {
      window.removeEventListener("resize", resizeHandler);

      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.dispose();
        terminalInstanceRef.current = null;
      }
    };
  }, [initializeTerminal]);

  return { terminalRef };
};

const CodeEditor: React.FC = () => {
  const { code, updateCode } = useActiveCode();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const { terminalRef } = useTerminal(theme);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState("/App.js");
  const [files, setFiles] = useState(defaultFiles);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (terminalRef.current) {
      if (!terminal) {
        const term = new Terminal({
          cursorBlink: true,
          theme: {
            background: theme === "dark" ? "#1a1b1e" : "#ffffff",
            foreground: theme === "dark" ? "#ffffff" : "#000000",
          },
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalRef.current);
        fitAddon.fit();
        term.write("npm $ ");
        let currentCommand = "";

        term.onKey(({ key, domEvent }) => {
          if (domEvent.key === "Enter") {
            term.write("\r\nnpm $ ");
            console.log("Command entered:", currentCommand);
            currentCommand = "";
          } else if (domEvent.key === "Backspace") {
            if (currentCommand.length > 0) {
              term.write("\b \b");
              currentCommand = currentCommand.slice(0, -1);
            }
          } else {
            term.write(key);
            currentCommand += key;
          }
        });
        setTerminal(term);
      } else {
        // Dispose of the old terminal
        terminal.dispose();

        // Create a new terminal with the updated theme
        const newTerminal = new Terminal({
          cursorBlink: true,
          theme: {
            background: theme === "dark" ? "#1a1b1e" : "#ffffff",
            foreground: theme === "dark" ? "#ffffff" : "#000000",
          },
        });
        const fitAddon = new FitAddon();
        newTerminal.loadAddon(fitAddon);
        newTerminal.open(terminalRef.current);
        fitAddon.fit();
        newTerminal.write("npm $ "); // Simply re-prompt
        newTerminal.focus();

        // Re-attach the key handler
        let currentCommand = "";
        newTerminal.onKey(({ key, domEvent }) => {
          if (domEvent.key === "Enter") {
            newTerminal.write("\r\nnpm $ ");
            console.log("Command entered:", currentCommand);
            currentCommand = "";
          } else if (domEvent.key === "Backspace") {
            if (currentCommand.length > 0) {
              newTerminal.write("\b \b");
              currentCommand = currentCommand.slice(0, -1);
            }
          } else {
            newTerminal.write(key);
            currentCommand += key;
          }
        });

        setTerminal(newTerminal);
      }
    }
  }, [terminalRef, terminal, theme]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const generateSuggestions = async () => {
    try {
      setIsGenerating(true);
      setSuggestions([]); // Clear previous suggestions
      setShowSuggestions(false);

      // Validate API key
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("Gemini API key is not configured");
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-pro" });

      const prompt = `Analyze this React code and provide 3 specific, actionable suggestions for improvement. Format your response as a numbered list of concise suggestions:
  
  Code:
  ${code}
  
  Suggestions:`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      // Parse suggestions, handling different potential response formats
      const parsedSuggestions = responseText
        .split("\n")
        .filter(
          (line) => line.trim() && (line.match(/^\d+\./) || line.match(/^-/)) // Match numbered or bulleted lists
        )
        .map((line) => line.replace(/^\d+\.\s*|-\s*/, "").trim()) // Remove list markers
        .slice(0, 3); // Limit to 3 suggestions

      if (parsedSuggestions.length === 0) {
        throw new Error("No suggestions generated");
      }

      setSuggestions(parsedSuggestions);
      setShowSuggestions(true);
    } catch (error) {
      console.error("Error generating suggestions:", error);

      // Provide user-friendly error handling
      setSuggestions([
        "Unable to generate suggestions. Please check your API configuration.",
        "Ensure your Gemini API key is correctly set in the environment variables.",
        "Verify your internet connection and try again.",
      ]);
      setShowSuggestions(true);
    } finally {
      setIsGenerating(false);
    }
  };

  const applySuggestion = async (suggestion: string) => {
    try {
      setIsGenerating(true);

      // Validate API key
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("Gemini API key is not configured");
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-pro" });

      const prompt = `You are a React code improvement assistant. 
  Modify this React code based on the following specific suggestion:
  Suggestion: "${suggestion}"
  
  Current Code:
  ${code}
  
  Respond ONLY with the improved code. Do not include any explanatory text or comments.`;

      const result = await model.generateContent(prompt);
      const improvedCode = result.response.text().trim();

      // Additional validation to prevent empty or unchanged code
      if (!improvedCode || improvedCode === code) {
        throw new Error("No meaningful code improvement generated");
      }

      updateCode(improvedCode);
      setShowSuggestions(false);
    } catch (error) {
      console.error("Error applying suggestion:", error);

      // Provide user feedback
      alert(
        "Unable to apply the suggestion. Please try again or modify manually."
      );
    } finally {
      setIsGenerating(false);
    }
  };
  const addNewFile = () => {
    const fileName = prompt("Enter file name (e.g., Component.js):");
    if (fileName) {
      setFiles((prev) => ({
        ...prev,
        [`/${fileName}`]: "// Add your code here",
      }));
    }
  };

  const deleteFile = (file: string) => {
    if (Object.keys(files).length > 1 && confirm(`Delete ${file}?`)) {
      const newFiles = { ...files };
      delete newFiles[file];
      setFiles(newFiles);
      setSelectedFile(Object.keys(newFiles)[0]);
    }
  };

  return (
    <div
      className={`min-h-screen ${
        theme === "dark" ? "bg-gray-900" : "bg-gray-50"
      }`}
    >
      <div className="container mx-auto p-4">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <Code2
              className={theme === "dark" ? "text-white" : "text-gray-900"}
            />
            <h1
              className={`text-2xl font-bold ${
                theme === "dark" ? "text-white" : "text-gray-900"
              }`}
            >
              React Live Editor
            </h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() =>
                setTheme((t) => (t === "light" ? "dark" : "light"))
              }
              className="p-2 rounded-md bg-blue-500 text-white hover:bg-blue-600"
              title={
                theme === "light"
                  ? "Switch to dark mode"
                  : "Switch to light mode"
              }
            >
              {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <button
              onClick={generateSuggestions}
              disabled={isGenerating}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
            >
              <Play size={20} />
              {isGenerating ? "Analyzing..." : "Get Suggestions"}
            </button>
            <button
              onClick={addNewFile}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-purple-500 text-white hover:bg-purple-600"
            >
              <FileText size={20} />
              New File
            </button>
          </div>
        </div>

        {showSuggestions && suggestions.length > 0 && (
          <div
            className={`mb-4 p-4 rounded-lg ${
              theme === "dark" ? "bg-gray-800" : "bg-white"
            } shadow-lg`}
          >
            <h2
              className={`text-lg font-semibold mb-2 ${
                theme === "dark" ? "text-white" : "text-gray-900"
              }`}
            >
              Suggestions
            </h2>
            <ul className="space-y-2">
              {suggestions.map((suggestion, index) => (
                <li key={index} className="flex items-center justify-between">
                  <span
                    className={
                      theme === "dark" ? "text-gray-300" : "text-gray-700"
                    }
                  >
                    {suggestion}
                  </span>
                  <button
                    onClick={() => applySuggestion(suggestion)}
                    className="px-3 py-1 rounded-md bg-blue-500 text-white hover:bg-blue-600 text-sm"
                  >
                    Apply
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div
            className={`rounded-lg overflow-hidden shadow-lg ${
              theme === "dark" ? "bg-gray-800" : "bg-white"
            }`}
          >
            <div className="flex items-center gap-2 p-2 border-b border-gray-200">
              {Object.keys(files).map((file) => (
                <div
                  key={file}
                  className={`flex items-center gap-1 px-3 py-1 rounded-md cursor-pointer ${
                    selectedFile === file
                      ? "bg-blue-500 text-white"
                      : theme === "dark"
                      ? "text-gray-300 hover:bg-gray-700"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                  onClick={() => setSelectedFile(file)}
                >
                  <FileText size={16} />
                  {file.slice(1)}
                  {Object.keys(files).length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFile(file);
                      }}
                      className="ml-2 text-sm hover:text-red-500"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <SandpackCodeEditor
              showTabs
              showLineNumbers
              showInlineErrors
              style={{ height: "400px" }}
            />
          </div>
          <div className="rounded-lg overflow-hidden shadow-lg">
            <SandpackPreview style={{ height: "400px" }} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div
            ref={terminalRef}
            className="rounded-lg overflow-hidden shadow-lg"
            style={{
              height: "200px",
              background: theme === "dark" ? "#1a1b1e" : "#ffffff",
            }}
          />
          <div className="rounded-lg overflow-hidden shadow-lg">
            <SandpackConsole style={{ height: "200px" }} />
          </div>
        </div>
      </div>
    </div>
  );
};

function App() {
  return (
    <SandpackProvider template="react" files={defaultFiles} theme="auto">
      <SandpackLayout>
        <CodeEditor />
      </SandpackLayout>
    </SandpackProvider>
  );
}

export default App;
