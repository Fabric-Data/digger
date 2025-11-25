# OpenTaco Benchmarks

This directory contains Terraform configurations for benchmarking OpenTaco cloud product (remote runs) performance.

## Benchmark Categories

### 01-simple-null
**Purpose**: Baseline test for minimal Terraform execution overhead  
**What it tests**: Basic Terraform runtime with a single null resource

### 02-10k-nulls
**Purpose**: Test performance with large number of resources  
**What it tests**: Plan/apply time scaling with 10,000 simple resources

### 03-ec2-midsize
**Purpose**: Test real-world cloud resource provisioning  
**What it tests**: 
- AWS provider initialization
- Network resource creation (VPC, subnet, IGW, route tables)
- EC2 instance (t3.medium) provisioning
- Data source queries

**Requirements**: AWS credentials configured

### 04-long-running-eks
**Purpose**: Test performance with long-running resource provisioning (10+ minutes)  
**What it tests**:
- EKS cluster creation
- Node group provisioning
- IAM role setup
- Multi-AZ networking

**Requirements**: AWS credentials configured  
**Note**: This is reserved for offline/extreme testing due to cost and time

### 05-1k-nulls-dependencies
**Purpose**: Test dependency graph resolution and parallel execution limits  
**What it tests**:
- Dependency chain resolution (1000-resource chain)
- Multi-layer dependencies
- Parallelization effectiveness with constrained DAG

### 06-many-child-modules
**Purpose**: Test module loading and initialization performance  
**What it tests**:
- Module instantiation (50 child modules)
- Module output aggregation
- Module isolation

### 07-interdependent-modules
**Purpose**: Test module dependency resolution and execution ordering  
**What it tests**:
- 4 layers of modules (base → intermediate → advanced → cross-dependent)
- Inter-module dependencies
- Complex dependency graph across modules
- 45 total module instances with interdependencies

## Running Benchmarks

### Manual Execution

Each benchmark is in its own directory. To run manually:

```bash
cd <benchmark-directory>
terraform init
terraform plan
terraform apply
```

### Automated Execution

Use the automation scripts to run all benchmarks and collect metrics:

```bash
# Run all benchmarks (init + plan only, no apply)
./run-benchmarks.sh

# Run specific benchmarks (by number)
./run-benchmarks.sh -b "01,03,05"

# Run with apply (WARNING: creates real resources!)
./run-benchmarks.sh --apply

# Run plan only, skip init
./run-benchmarks.sh --no-init
```

#### Options

- `-b, --benchmarks LIST` - Comma-separated list of benchmarks (e.g., "01,03,05")
- `--no-init` - Skip terraform init
- `--no-plan` - Skip terraform plan
- `--apply` - Run terraform apply (default: off)
- `--no-cleanup` - Don't clean up .terraform directories
- `-o, --output DIR` - Output directory for results (default: ./results)

### Viewing Results

Results are automatically saved in JSON and CSV formats with timestamps.

```bash
# View most recent results in table format
./format-results.sh

# View specific results file
./format-results.sh results/benchmark-results-20231124-120000.json
```

Sample output:
```
Benchmark                      Init (s)     Plan (s)     Apply (s)    Total (s)   
----------                     --------     --------     ---------    ---------   
01-simple-null                 2.34         0.45         skipped      2.79        
02-10k-nulls                   3.12         15.23        skipped      18.35       
03-ec2-midsize                 4.56         2.11         skipped      6.67        
```

### Comparing Results

Compare two benchmark runs to see performance changes:

```bash
# Compare two most recent runs
./compare-results.sh

# Compare specific files
./compare-results.sh results/benchmark-results-20231124-120000.json results/benchmark-results-20231124-130000.json
```

Sample output:
```
Benchmark                      Baseline (s)    Current (s)     Diff (s)        Change %  
01-simple-null                 2.79            2.65            ↓ -0.14         -5.0%     
02-10k-nulls                   18.35           17.89           ↓ -0.46         -2.5%     
03-ec2-midsize                 6.67            6.82            ↑ +0.15         +2.2%     
```

### Results Structure

Results are saved in the `./results` directory:

- **JSON format**: Full detailed results with timestamps
  ```json
  [
    {
      "benchmark": "01-simple-null",
      "timestamp": "2023-11-24T12:00:00Z",
      "stages": {
        "init": { "duration_seconds": 2.34, "status": "success" },
        "plan": { "duration_seconds": 0.45, "status": "success" },
        "apply": { "duration_seconds": 0, "status": "skipped" }
      }
    }
  ]
  ```

- **CSV format**: Easy to import into spreadsheets
  ```csv
  benchmark,stage,duration_seconds,status,timestamp
  01-simple-null,init,2.34,success,2023-11-24T12:00:00Z
  01-simple-null,plan,0.45,success,2023-11-24T12:00:00Z
  ```

## Next Steps

1. **Competitor Comparison**: Run benchmarks against Terraform Cloud, Spacelift, etc.
2. **Advanced Metrics**: Collect additional metrics:
   - Network transfer time
   - State file size
   - Log volume
   - Resource count vs. execution time correlation
3. **CI Integration**: Add benchmark runs to CI pipeline
4. **Performance Tracking**: Track performance over time, create dashboards

## Notes

- Benchmarks 03 and 04 require AWS credentials and will incur costs
- Benchmark 04 (EKS) takes 10+ minutes and should be used sparingly
- All null resource benchmarks can be run without cloud credentials
- Consider implementing `-target` flags for partial benchmark runs during development
