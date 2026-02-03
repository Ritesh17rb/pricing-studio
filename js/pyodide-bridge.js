/**
 * Pyodide Bridge - Interface between JavaScript and Python models
 * Loads Python statistical models and provides prediction methods
 */

class PyodideModelBridge {
  constructor() {
    this.pyodide = null;
    this.modelsLoaded = false;
    this.loading = false;
  }

  /**
   * Initialize Pyodide and load Python packages
   */
  async initialize() {
    if (this.pyodide) return this.pyodide;
    if (this.loading) {
      // Wait for existing initialization
      while (this.loading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.pyodide;
    }

    try {
      this.loading = true;
      console.log('🐍 Initializing Pyodide...');

      // Load Pyodide
      this.pyodide = await loadPyodide();

      // Load required packages (only numpy for now - lightweight)
      console.log('📦 Loading Python packages...');
      await this.pyodide.loadPackage(['numpy']);

      console.log('✅ Pyodide initialized successfully');
      this.loading = false;
      return this.pyodide;
    } catch (error) {
      this.loading = false;
      console.error('❌ Failed to initialize Pyodide:', error);
      throw error;
    }
  }

  /**
   * Load Python model scripts
   */
  async loadModels() {
    if (this.modelsLoaded) return;

    try {
      await this.initialize();

      console.log('📥 Loading Python model scripts...');

      // Load acquisition model
      const acquisitionCode = await fetch('python/acquisition_model.py').then(r => r.text());
      await this.pyodide.runPythonAsync(acquisitionCode);

      // Load churn model
      const churnCode = await fetch('python/churn_model.py').then(r => r.text());
      await this.pyodide.runPythonAsync(churnCode);

      // Load migration model
      const migrationCode = await fetch('python/migration_model.py').then(r => r.text());
      await this.pyodide.runPythonAsync(migrationCode);

      this.modelsLoaded = true;
      console.log('✅ All Python models loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load Python models:', error);
      throw error;
    }
  }

  /**
   * Predict acquisition using Python model
   */
  async predictAcquisition(scenario) {
    await this.loadModels();

    try {
      // Set scenario in Python namespace
      this.pyodide.globals.set('scenario', this.pyodide.toPy(scenario));

      // Run Python prediction
      const result = await this.pyodide.runPythonAsync(`
predict_acquisition(scenario)
      `);

      // Convert Python dict to JavaScript object
      return result.toJs({ dict_converter: Object.fromEntries });
    } catch (error) {
      console.error('❌ Acquisition prediction failed:', error);
      throw error;
    }
  }

  /**
   * Predict acquisition by customer segments
   */
  async predictAcquisitionBySegment(scenario, segments) {
    await this.loadModels();

    try {
      // Serialize to JSON to avoid global variable race conditions
      const scenarioJson = JSON.stringify(scenario);
      const segmentsJson = JSON.stringify(segments);

      const result = await this.pyodide.runPythonAsync(`
import json
scenario_data = json.loads('''${scenarioJson}''')
segments_data = json.loads('''${segmentsJson}''')
json.dumps(predict_acquisition_by_segment(scenario_data, segments_data))
      `);

      // Parse JSON string to get proper JavaScript array
      return JSON.parse(result);
    } catch (error) {
      console.error('❌ Segment acquisition prediction failed:', error);
      throw error;
    }
  }

  /**
   * Predict churn by time horizon using Python model
   */
  async predictChurn(scenario) {
    await this.loadModels();

    try {
      this.pyodide.globals.set('scenario', this.pyodide.toPy(scenario));

      const result = await this.pyodide.runPythonAsync(`
predict_churn_by_horizon(scenario)
      `);

      return result.toJs({ dict_converter: Object.fromEntries });
    } catch (error) {
      console.error('❌ Churn prediction failed:', error);
      throw error;
    }
  }

  /**
   * Predict churn by customer segments
   */
  async predictChurnBySegment(scenario, segments) {
    await this.loadModels();

    try {
      // Serialize to JSON to avoid global variable race conditions
      const scenarioJson = JSON.stringify(scenario);
      const segmentsJson = JSON.stringify(segments);

      const result = await this.pyodide.runPythonAsync(`
import json
scenario_data = json.loads('''${scenarioJson}''')
segments_data = json.loads('''${segmentsJson}''')
json.dumps(predict_churn_by_segment(scenario_data, segments_data))
      `);

      return JSON.parse(result);
    } catch (error) {
      console.error('❌ Segment churn prediction failed:', error);
      throw error;
    }
  }

  /**
   * Predict tier migration matrix using Python model
   */
  async predictMigration(scenario) {
    await this.loadModels();

    try {
      this.pyodide.globals.set('scenario', this.pyodide.toPy(scenario));

      const result = await this.pyodide.runPythonAsync(`
predict_migration_matrix(scenario)
      `);

      return result.toJs({ dict_converter: Object.fromEntries });
    } catch (error) {
      console.error('❌ Migration prediction failed:', error);
      throw error;
    }
  }

  /**
   * Check if Pyodide is ready
   */
  isReady() {
    return this.modelsLoaded;
  }

  /**
   * Get loading status
   */
  getStatus() {
    if (this.modelsLoaded) return 'ready';
    if (this.loading) return 'loading';
    return 'not-initialized';
  }
}

// Export singleton instance
export const pyodideBridge = new PyodideModelBridge();

// Also expose globally for debugging
if (typeof window !== 'undefined') {
  window.pyodideBridge = pyodideBridge;
}
