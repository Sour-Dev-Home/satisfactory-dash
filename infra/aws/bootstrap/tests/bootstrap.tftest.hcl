# `terraform test` for the state-bucket bootstrap (#405), against a mock provider: no credentials.

mock_provider "aws" {}

variables {
  state_bucket_name = "satis-tfstate-example"
}

run "state_bucket_is_versioned_encrypted_and_private" {
  command = apply

  assert {
    condition     = aws_s3_bucket.state.bucket == var.state_bucket_name && aws_s3_bucket.state.force_destroy == false
    error_message = "the bucket has the given name and can't be destroyed with state in it"
  }

  assert {
    condition     = aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled" && aws_s3_bucket_versioning.state.bucket == aws_s3_bucket.state.id
    error_message = "versioning is on, so an overwritten state can be recovered"
  }

  assert {
    condition = anytrue([for r in aws_s3_bucket_server_side_encryption_configuration.state.rule :
    r.apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"])
    error_message = "server-side encryption by default (SSE-S3, no KMS charge)"
  }

  assert {
    condition = (aws_s3_bucket_public_access_block.state.block_public_acls && aws_s3_bucket_public_access_block.state.block_public_policy &&
    aws_s3_bucket_public_access_block.state.ignore_public_acls && aws_s3_bucket_public_access_block.state.restrict_public_buckets)
    error_message = "all four block-public-access settings are on"
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.state.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "ACLs are disabled"
  }

  assert {
    condition     = output.backend_config.bucket == var.state_bucket_name && output.backend_config.region == "us-east-1"
    error_message = "the bootstrap prints what the main module's backend needs"
  }
}

run "bucket_policy_denies_plain_http" {
  command = apply

  assert {
    condition     = strcontains(aws_s3_bucket_policy.state.policy, "aws:SecureTransport") && strcontains(aws_s3_bucket_policy.state.policy, "\"Deny\"")
    error_message = "the state bucket refuses requests without TLS"
  }
}

run "bucket_name_is_validated" {
  command = plan

  variables {
    state_bucket_name = "Not_A_Bucket"
  }

  expect_failures = [var.state_bucket_name]
}
