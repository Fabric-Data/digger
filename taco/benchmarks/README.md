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

Each benchmark is in its own directory. To run:

```bash
cd <benchmark-directory>
terraform init
terraform plan
terraform apply
```

### Timing a Benchmark

```bash
time terraform plan
time terraform apply
```

For more detailed timing:

```bash
TF_LOG=DEBUG terraform plan 2>&1 | grep -i "duration"
```

## Next Steps

1. **Automation**: Create scripts to automate timing collection
2. **Comparison**: Run benchmarks against competitors (Terraform Cloud, Spacelift, etc.)
3. **Metrics**: Collect and analyze:
   - Plan time
   - Apply time
   - Network transfer time
   - State file size
   - Log volume
   - Resource count vs. execution time correlation

## Notes

- Benchmarks 03 and 04 require AWS credentials and will incur costs
- Benchmark 04 (EKS) takes 10+ minutes and should be used sparingly
- All null resource benchmarks can be run without cloud credentials
- Consider implementing `-target` flags for partial benchmark runs during development
