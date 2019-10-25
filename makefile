
all: generate deposit index

clean-repo:
	rm -rf ../ocfl-nginx/test_repos/repo_ocfl

	# Todo - clear Solr


clean:
	rm -rf output

generate:
	node random.js -n ${NUM}

deposit:
	node ro-crate-deposit.js --repo ../ocfl-nginx/test_repos/repo_ocfl  --name ocfl_demo output/*

index:
	node commit-to-solr.js 